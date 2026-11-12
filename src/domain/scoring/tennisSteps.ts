import { tennisPadRules } from '@seazn/engine/pad';
import type { PadSide } from '@/domain/scoring/padView';
import type { SanctionOption, SanctionSheet } from '@/domain/scoring/setBasedSanction';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { isBreakKind } from '@/domain/scoring/tennisLedgerHistory';
import type {
  TennisBreakKind,
  TennisDisplay,
  TennisPadKey,
  TennisTap,
} from '@/domain/scoring/tennisTypes';

/**
 * The award and the break, step by step (S2-7 Task 7; rulings 219, 220). Award game: a side, then a confirm, then
 * `tennis.game.award {winner}`. Break: a kind (the engine's list, in its order), then the side it is for or "Both / none",
 * then `tennis.interruption {kind, by?}` with no person, duration or time (ruling 220). A choice a step does not offer leaves
 * the step as it is, so a second press of one choice moves once.
 */

type Sheet = SanctionSheet<TennisPadKey>;
type Option = SanctionOption<TennisPadKey>;

const CONFIRM = 'confirm';
const BOTH = 'both';

/** Each side as typed, top first, as a step's choices. */
const sideOptions = (display: TennisDisplay): readonly Option[] =>
  (['first', 'second'] as const).map((side) => ({
    id: side,
    label: sideNames(display.sides[side]),
    tone: 'standard',
  }));

const sideOf = (choice: string): PadSide | undefined =>
  choice === 'first' || choice === 'second' ? choice : undefined;

// ---------------------------------------------------------------------------------------------------------------
// Award game
// ---------------------------------------------------------------------------------------------------------------

export type AwardStep =
  { readonly step: 'side' } | { readonly step: 'confirm'; readonly side: PadSide };

export type AwardMove =
  | { readonly kind: 'step'; readonly step: AwardStep }
  | { readonly kind: 'record'; readonly tap: Extract<TennisTap, { readonly kind: 'award' }> };

export const startAward = (): AwardStep => ({ step: 'side' });

export function chooseAward(step: AwardStep, choice: string): AwardMove {
  const stay: AwardMove = { kind: 'step', step };
  if (step.step === 'side') {
    const side = sideOf(choice);
    return side === undefined ? stay : { kind: 'step', step: { step: 'confirm', side } };
  }
  return choice === CONFIRM ? { kind: 'record', tap: { kind: 'award', side: step.side } } : stay;
}

/** The step before this one, or null from the first (the sheet closes). */
export const backAward = (step: AwardStep): AwardStep | null =>
  step.step === 'confirm' ? { step: 'side' } : null;

export function awardSheet(step: AwardStep, display: TennisDisplay): Sheet {
  if (step.step === 'side') {
    return {
      title: { key: 'scoring.tennis.award.title' },
      body: { key: 'scoring.tennis.award.ask' },
      options: sideOptions(display),
    };
  }
  return {
    title: { key: 'scoring.tennis.award.confirm.title' },
    body: {
      key: 'scoring.tennis.award.confirm.body',
      vars: { side: sideNames(display.sides[step.side]) },
    },
    options: [
      { id: CONFIRM, label: { key: 'scoring.tennis.award.confirm.action' }, tone: 'standard' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Break
// ---------------------------------------------------------------------------------------------------------------

/** The kinds the engine lists, in its order: never a list of our own. */
const KINDS: readonly TennisBreakKind[] = tennisPadRules.interruptionKinds.filter(isBreakKind);

export type BreakStep =
  { readonly step: 'kind' } | { readonly step: 'side'; readonly breakKind: TennisBreakKind };

export type BreakMove =
  | { readonly kind: 'step'; readonly step: BreakStep }
  | { readonly kind: 'record'; readonly tap: Extract<TennisTap, { readonly kind: 'break' }> };

export const startBreak = (): BreakStep => ({ step: 'kind' });

export function chooseBreak(step: BreakStep, choice: string): BreakMove {
  const stay: BreakMove = { kind: 'step', step };
  if (step.step === 'kind') {
    const breakKind = KINDS.find((each) => each === choice);
    return breakKind === undefined ? stay : { kind: 'step', step: { step: 'side', breakKind } };
  }
  if (choice === BOTH) {
    return { kind: 'record', tap: { kind: 'break', breakKind: step.breakKind, side: null } };
  }
  const side = sideOf(choice);
  if (side === undefined) return stay;
  return { kind: 'record', tap: { kind: 'break', breakKind: step.breakKind, side } };
}

/** The step before this one, or null from the first (the sheet closes). */
export const backBreak = (step: BreakStep): BreakStep | null =>
  step.step === 'side' ? { step: 'kind' } : null;

export function breakSheet(step: BreakStep, display: TennisDisplay): Sheet {
  if (step.step === 'kind') {
    return {
      title: { key: 'scoring.tennis.break.title' },
      body: { key: 'scoring.tennis.break.askKind' },
      options: KINDS.map((kind) => ({
        id: kind,
        label: { key: `scoring.tennis.break.kind.${kind}` },
        tone: 'standard',
      })),
    };
  }
  return {
    title: { key: `scoring.tennis.break.kind.${step.breakKind}` },
    body: { key: 'scoring.tennis.break.askSide' },
    options: [
      ...sideOptions(display),
      { id: BOTH, label: { key: 'scoring.tennis.break.both' }, tone: 'standard' },
    ],
  };
}
