import { tennisPadRules } from '@seazn/engine/pad';
import type { PadSide, PadText } from '@/domain/scoring/padView';
import type { SanctionOption, SanctionSheet } from '@/domain/scoring/setBasedSanction';
import { seatsOf, sideNames } from '@/domain/scoring/setBasedSides';
import { isSeenLevel } from '@/domain/scoring/tennisLedgerHistory';
import { levelWord } from '@/domain/scoring/tennisLevels';
import type {
  TennisDisplay,
  TennisLevel,
  TennisPadKey,
  TennisTap,
} from '@/domain/scoring/tennisTypes';
import type { Bootstrap } from '@/domain/scoring/wire';

/**
 * A code violation, step by step (S2-7 Task 7; ruling 218): the level, then the player when the side has two (doubles), then
 * a confirm, then the violation is sent. The phone sends the violation and nothing else: it moves no score (TN-SS-2), so what
 * to tap next is the scorer's, and `violationDone` says it. The levels are the engine's own list without `default`, which is
 * the organiser's and never the phone's (spec §2).
 */

type Text = PadText<TennisPadKey>;

/** A player a side's sheet lists: the bootstrap's member, by person id. */
export type TennisSheetPerson = { readonly personId: string; readonly name: string };
export type TennisPeople = Readonly<Record<PadSide, readonly TennisSheetPerson[]>>;

const NOBODY: TennisPeople = { first: [], second: [] };

/** Both sides' players, top first, in the side's order; nobody while either seat is empty. */
export function tennisPeopleOf(bootstrap: Bootstrap): TennisPeople {
  const seats = seatsOf(bootstrap);
  if (seats === null) return NOBODY;
  const of = (side: PadSide): readonly TennisSheetPerson[] =>
    seats[side].members.map((one) => ({ personId: one.personId, name: one.fullName }));
  return { first: of('first'), second: of('second') };
}

/** A level the phone may send: any the engine lists but `default`. */
const isSendable = (level: string): level is TennisLevel =>
  level !== 'default' && isSeenLevel(level);

/** The levels the engine lists, lightest first, without `default`: never a list of our own. */
const LEVELS: readonly TennisLevel[] = tennisPadRules.sanctionLevels.filter(isSendable);

export type ViolationStep =
  | { readonly step: 'level'; readonly side: PadSide }
  | { readonly step: 'person'; readonly side: PadSide; readonly level: TennisLevel }
  | {
      readonly step: 'confirm';
      readonly side: PadSide;
      readonly level: TennisLevel;
      readonly person: string | null;
    };

type ViolationTap = Extract<TennisTap, { readonly kind: 'violation' }>;

/** The next step, or the violation to record. */
export type ViolationMove =
  | { readonly kind: 'step'; readonly step: ViolationStep }
  | { readonly kind: 'record'; readonly tap: ViolationTap };

export type ViolationSheet = SanctionSheet<TennisPadKey>;

export const startViolation = (side: PadSide): ViolationStep => ({ step: 'level', side });

/** Doubles ask the player, from the people the side's sheet lists; with none listed there is no one to ask. */
const asksPerson = (side: PadSide, display: TennisDisplay, people: TennisPeople): boolean =>
  display.doubles && people[side].length > 0;

/** A choice the step does not offer leaves the step as it is, so a second press of one choice moves once. */
export function chooseViolation(
  step: ViolationStep,
  choice: string,
  display: TennisDisplay,
  people: TennisPeople,
): ViolationMove {
  const stay: ViolationMove = { kind: 'step', step };
  switch (step.step) {
    case 'level': {
      const level = LEVELS.find((each) => each === choice);
      if (level === undefined) return stay;
      const next: ViolationStep = asksPerson(step.side, display, people)
        ? { step: 'person', side: step.side, level }
        : { step: 'confirm', side: step.side, level, person: null };
      return { kind: 'step', step: next };
    }
    case 'person': {
      const person = people[step.side].find((one) => one.personId === choice);
      if (person === undefined) return stay;
      const { side, level } = step;
      return { kind: 'step', step: { step: 'confirm', side, level, person: person.personId } };
    }
    case 'confirm': {
      if (choice !== CONFIRM) return stay;
      const { side, level, person } = step;
      return { kind: 'record', tap: { kind: 'violation', side, level, person } };
    }
  }
}

const CONFIRM = 'confirm';

/** The step before this one, or null from the first (the sheet closes). */
export function backViolation(
  step: ViolationStep,
  display: TennisDisplay,
  people: TennisPeople,
): ViolationStep | null {
  switch (step.step) {
    case 'level':
      return null;
    case 'person':
      return { step: 'level', side: step.side };
    case 'confirm':
      return asksPerson(step.side, display, people)
        ? { step: 'person', side: step.side, level: step.level }
        : { step: 'level', side: step.side };
  }
}

/** One step as a sheet asks it: a title, a line naming what is already chosen, and the choices. */
export function violationSheet(
  step: ViolationStep,
  display: TennisDisplay,
  people: TennisPeople,
): ViolationSheet {
  switch (step.step) {
    case 'level':
      return {
        title: { key: 'scoring.tennis.violation.title' },
        body: sideNames(display.sides[step.side]),
        options: LEVELS.map((level): SanctionOption<TennisPadKey> => ({
          id: level,
          label: levelWord(level),
          tone: level === 'game_penalty' ? 'destructive' : 'standard',
        })),
      };
    case 'person':
      return {
        title: { key: 'scoring.tennis.violation.who' },
        body: levelWord(step.level),
        options: people[step.side].map((one) => ({
          id: one.personId,
          label: one.name,
          tone: 'standard',
        })),
      };
    case 'confirm':
      return {
        title: { key: 'scoring.tennis.violation.confirm.title' },
        body: {
          key: 'scoring.tennis.violation.confirm.body',
          vars: { level: levelWord(step.level), who: whoOf(step, display, people) },
        },
        options: [
          {
            id: CONFIRM,
            label: { key: 'scoring.tennis.violation.confirm.action' },
            tone: 'standard',
          },
        ],
      };
  }
}

/** The person the violation is for, by name as the sheet lists it, else the side's names. */
function whoOf(
  step: Extract<ViolationStep, { readonly step: 'confirm' }>,
  display: TennisDisplay,
  people: TennisPeople,
): string {
  const named = people[step.side].find((one) => one.personId === step.person);
  return named?.name ?? sideNames(display.sides[step.side]);
}

/**
 * What to tap once the violation is recorded, or nothing: a point penalty gives the other side the point (ruling 218), a game
 * penalty the game (Award game; in a tie-break its cell is disabled and the organiser decides), a warning nothing. The
 * sanction moves no score, so the scorer taps it.
 */
export function violationDone(
  level: TennisLevel,
  side: PadSide,
  display: TennisDisplay,
): Text | null {
  const other = sideNames(display.sides[side === 'first' ? 'second' : 'first']);
  if (level === 'point_penalty')
    return { key: 'scoring.tennis.violation.done.point', vars: { other } };
  if (level !== 'game_penalty') return null;
  if (display.breaker !== null) return { key: 'scoring.tennis.violation.done.breaker' };
  return { key: 'scoring.tennis.violation.done.game', vars: { other } };
}
