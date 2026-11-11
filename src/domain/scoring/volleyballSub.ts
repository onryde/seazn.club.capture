import type { PadSide } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import type { SanctionOption, SanctionSheet } from '@/domain/scoring/setBasedSanction';
import { playersOf, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import type {
  VolleyballPadKey,
  VolleyballSide,
  VolleyballTap,
} from '@/domain/scoring/volleyballTypes';

/**
 * A substitution, step by step (S2-6 Task 7; rulings 175, 182): who comes off, then who comes on, both from the side's
 * players. Anyone on the sheet is listed, including a player who has already left (the phone does not track who is on
 * court; the engine judges). A side with fewer than two named players cannot name a pair, so the sub is recorded for the
 * side alone, at once. Indoor only: beach records none, and the pad offers no Sub there (`volleyballTools`).
 */
export type SubStep =
  | { readonly step: 'off'; readonly side: PadSide }
  | { readonly step: 'on'; readonly side: PadSide; readonly off: string };

type SubTap = Extract<VolleyballTap, { readonly kind: 'sub' }>;

/** The next step, or the sub to record. */
export type SubMove =
  | { readonly kind: 'step'; readonly step: SubStep }
  | { readonly kind: 'record'; readonly tap: SubTap };

export type SubSheet = SanctionSheet<VolleyballPadKey>;

/** The first step, or the side's sub at once when it names too few players to pair. */
export function startSub(side: PadSide, people: VolleyballPeople): SubMove {
  if (playersOf(people[side]).length < 2) return { kind: 'record', tap: { kind: 'sub', side } };
  return { kind: 'step', step: { step: 'off', side } };
}

/** A choice the step does not offer leaves the step as it is, so a second press of one choice moves once. */
export function chooseSub(step: SubStep, choice: string, people: VolleyballPeople): SubMove {
  const stay: SubMove = { kind: 'step', step };
  const players = playersOf(people[step.side]);
  switch (step.step) {
    case 'off':
      return players.some((one) => one.personId === choice)
        ? { kind: 'step', step: { step: 'on', side: step.side, off: choice } }
        : stay;
    case 'on':
      return choice !== step.off && players.some((one) => one.personId === choice)
        ? { kind: 'record', tap: { kind: 'sub', side: step.side, off: step.off, on: choice } }
        : stay;
  }
}

/** Back: from On to Off; from Off, out of the sheet (null). */
export function backSub(step: SubStep): SubStep | null {
  return step.step === 'on' ? { step: 'off', side: step.side } : null;
}

/** One step as a sheet asks it: the title, what is already chosen (the side, then who comes off), and the choices. */
export function subSheet(
  step: SubStep,
  people: VolleyballPeople,
  sides: Readonly<Record<PadSide, VolleyballSide>>,
): SubSheet {
  const players = playersOf(people[step.side]);
  const option = (one: (typeof players)[number]): SanctionOption<VolleyballPadKey> => ({
    id: one.personId,
    label: one.name,
    tone: 'standard',
  });
  if (step.step === 'off') {
    return {
      title: { key: 'scoring.volleyball.sheet.off' },
      body: sideNames(sides[step.side]),
      options: players.map(option),
    };
  }
  const off = players.find((one) => one.personId === step.off);
  return {
    title: { key: 'scoring.volleyball.sheet.on' },
    body: off?.name ?? { key: 'scoring.volleyball.player' },
    options: players.filter((one) => one.personId !== step.off).map(option),
  };
}
