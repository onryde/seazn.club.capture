import {
  SANCTION_LEVELS,
  sanctionWord,
  type BadmintonSanction,
  type BadmintonSide,
  type SanctionLevelKey,
} from '@/domain/scoring/badmintonPad';
import type { PadSide, PadText, PadVar } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';

/**
 * A sanction, step by step (owner rulings, 2026-10-31): the level (the web's four), then the person (that side's
 * players: a singles side has one), then, for a disqualification only, a confirm that says it ends the match.
 */
export type SanctionStep =
  | { readonly step: 'level'; readonly side: PadSide }
  | {
      readonly step: 'person';
      readonly side: PadSide;
      readonly level: (typeof SANCTION_LEVELS)[number];
    }
  | { readonly step: 'confirm'; readonly side: PadSide; readonly person: string };

/** The next step, or the sanction to record. */
export type SanctionMove =
  | { readonly kind: 'step'; readonly step: SanctionStep }
  | { readonly kind: 'record'; readonly sanction: BadmintonSanction };

export type SanctionKey =
  | 'scoring.sanction.title'
  | 'scoring.sanction.who'
  | 'scoring.sanction.confirm.title'
  | 'scoring.sanction.confirm.body'
  | 'scoring.sanction.confirm.action'
  | SanctionLevelKey;

export type SanctionOption = {
  readonly id: string;
  /** A level's word, or a player's name as typed. */
  readonly label: PadVar<SanctionKey>;
  readonly tone: 'standard' | 'destructive';
};

/** One step as a sheet asks it: a title, a line naming what is already chosen, and the choices. */
export type SanctionSheet = {
  readonly title: PadText<SanctionKey>;
  readonly body: PadVar<SanctionKey>;
  readonly options: readonly SanctionOption[];
};

const CONFIRM = 'confirm';

export function startSanction(side: PadSide): SanctionStep {
  return { step: 'level', side };
}

/** A choice the step does not offer leaves the step as it is. */
export function chooseSanction(
  step: SanctionStep,
  choice: string,
  sides: Readonly<Record<PadSide, BadmintonSide>>,
): SanctionMove {
  const stay: SanctionMove = { kind: 'step', step };
  switch (step.step) {
    case 'level': {
      const level = SANCTION_LEVELS.find((each) => each === choice);
      return level === undefined
        ? stay
        : { kind: 'step', step: { step: 'person', side: step.side, level } };
    }
    case 'person': {
      const person = sides[step.side].players.find((_, at) => String(at) === choice);
      if (person === undefined) return stay;
      if (step.level === 'disqualification') {
        return { kind: 'step', step: { step: 'confirm', side: step.side, person } };
      }
      return { kind: 'record', sanction: { side: step.side, level: step.level, person } };
    }
    case 'confirm':
      return choice === CONFIRM
        ? {
            kind: 'record',
            sanction: { side: step.side, level: 'disqualification', person: step.person },
          }
        : stay;
  }
}

export function sanctionSheet(
  step: SanctionStep,
  sides: Readonly<Record<PadSide, BadmintonSide>>,
): SanctionSheet {
  switch (step.step) {
    case 'level':
      return {
        title: { key: 'scoring.sanction.title' },
        body: sideNames(sides[step.side]),
        options: SANCTION_LEVELS.map((level) => ({
          id: level,
          label: sanctionWord(level),
          tone: level === 'disqualification' ? 'destructive' : 'standard',
        })),
      };
    case 'person':
      return {
        title: { key: 'scoring.sanction.who' },
        body: sanctionWord(step.level),
        options: sides[step.side].players.map((player, at) => ({
          id: String(at),
          label: player,
          tone: 'standard',
        })),
      };
    case 'confirm':
      return {
        title: { key: 'scoring.sanction.confirm.title', vars: { person: step.person } },
        body: { key: 'scoring.sanction.confirm.body' },
        options: [
          { id: CONFIRM, label: { key: 'scoring.sanction.confirm.action' }, tone: 'destructive' },
        ],
      };
  }
}
