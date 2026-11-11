import { volleyballPadRules } from '@seazn/engine/pad';
import type { PadSide, PadText } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import type { SanctionOption, SanctionSheet } from '@/domain/scoring/setBasedSanction';
import { levelWord } from '@/domain/scoring/volleyballHistory';
import { isSanctionLevel } from '@/domain/scoring/volleyballLedgerHistory';
import { playersFirst, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import type {
  VolleyballPadKey,
  VolleyballSanctionLevel,
  VolleyballSide,
  VolleyballTap,
} from '@/domain/scoring/volleyballTypes';

/**
 * A sanction, step by step (S2-6 Task 7; rulings 174, 185, 187, 189): the level, then the person, from the side's players
 * and then its officials (a coach is sanctioned too). One person on the sheet is the sanction's at once; none records it
 * against the side alone (ruling 187). The phone sends the sanction and nothing else: what a penalty or an expulsion does
 * to the score or the team is the scorer's to tap, or the organiser's to decide (`sanctionNote` says so on the last step).
 */

/** The levels the engine lists, lightest first (`volleyballPadRules.sanctionLevels`): never a list of our own. */
const LEVELS: readonly VolleyballSanctionLevel[] =
  volleyballPadRules.sanctionLevels.filter(isSanctionLevel);

export type SanctionStep =
  | { readonly step: 'level'; readonly side: PadSide }
  | {
      readonly step: 'person';
      readonly side: PadSide;
      readonly level: VolleyballSanctionLevel;
    };

type SanctionTap = Extract<VolleyballTap, { readonly kind: 'sanction' }>;

/** The next step, or the sanction to record. */
export type SanctionMove =
  | { readonly kind: 'step'; readonly step: SanctionStep }
  | { readonly kind: 'record'; readonly tap: SanctionTap };

export type SanctionSheetOf = SanctionSheet<VolleyballPadKey>;

export const startSanction = (side: PadSide): SanctionStep => ({ step: 'level', side });

/** A choice the step does not offer leaves the step as it is, so a second press of one choice moves once. */
export function chooseSanction(
  step: SanctionStep,
  choice: string,
  people: VolleyballPeople,
): SanctionMove {
  const stay: SanctionMove = { kind: 'step', step };
  switch (step.step) {
    case 'level': {
      const level = LEVELS.find((each) => each === choice);
      return level === undefined ? stay : afterLevel(step.side, level, people);
    }
    case 'person': {
      const person = playersFirst(people[step.side]).find((one) => one.personId === choice);
      return person === undefined
        ? stay
        : {
            kind: 'record',
            tap: { kind: 'sanction', side: step.side, level: step.level, person: person.personId },
          };
    }
  }
}

function afterLevel(
  side: PadSide,
  level: VolleyballSanctionLevel,
  people: VolleyballPeople,
): SanctionMove {
  const [only, ...more] = playersFirst(people[side]);
  if (only === undefined) {
    return { kind: 'record', tap: { kind: 'sanction', side, level, person: null } };
  }
  if (more.length === 0) {
    return { kind: 'record', tap: { kind: 'sanction', side, level, person: only.personId } };
  }
  return { kind: 'step', step: { step: 'person', side, level } };
}

/** Back: from the person to the level; from the level, out of the sheet (null). */
export function backSanction(step: SanctionStep): SanctionStep | null {
  return step.step === 'person' ? { step: 'level', side: step.side } : null;
}

export function sanctionSheet(
  step: SanctionStep,
  people: VolleyballPeople,
  sides: Readonly<Record<PadSide, VolleyballSide>>,
): SanctionSheetOf {
  if (step.step === 'level') {
    return {
      title: { key: 'scoring.sanction.title' },
      body: sideNames(sides[step.side]),
      options: LEVELS.map((level): SanctionOption<VolleyballPadKey> => ({
        id: level,
        label: levelWord(level),
        tone: level === 'expulsion' || level === 'disqualification' ? 'destructive' : 'standard',
      })),
    };
  }
  return {
    title: { key: 'scoring.sanction.who' },
    body: levelWord(step.level),
    options: playersFirst(people[step.side]).map((one) => ({
      id: one.personId,
      label: one.name,
      tone: 'standard',
    })),
  };
}

/**
 * The line the scorer reads once a sanction is recorded, or none: a penalty gives the other side the rally, which the
 * scorer taps (ruling 185); an expulsion or a disqualification may leave a team short, which is the organiser's to end
 * (rulings 174, 189), indoor six, beach two. A warning says nothing.
 */
export function sanctionNote(
  level: VolleyballSanctionLevel,
  side: PadSide,
  sides: Readonly<Record<PadSide, VolleyballSide>>,
  beach: boolean,
): PadText<VolleyballPadKey> | null {
  if (level === 'penalty') {
    const other: PadSide = side === 'first' ? 'second' : 'first';
    return { key: 'scoring.volleyball.done.penalty', vars: { side: sideNames(sides[other]) } };
  }
  if (level === 'expulsion' || level === 'disqualification') {
    return {
      key: beach ? 'scoring.volleyball.done.fieldTwo' : 'scoring.volleyball.done.fieldSix',
      vars: { team: sideNames(sides[side]) },
    };
  }
  return null;
}
