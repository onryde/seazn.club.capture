import type { PadSide } from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import type { SanctionOption, SanctionSheet } from '@/domain/scoring/setBasedSanction';
import {
  playersOf,
  type VolleyballPeople,
  type VolleyballSheetPerson,
} from '@/domain/scoring/volleyballPeople';
import type {
  VolleyballPadKey,
  VolleyballSide,
  VolleyballSwap,
  VolleyballTap,
} from '@/domain/scoring/volleyballTypes';

/**
 * A substitution, step by step (S2-6 Task 7; rulings 175, 182, F4): who comes off, then who comes on. Off lists the
 * players on court, on lists everyone else on the side's sheet, bench and those who have left (never hidden). On court is
 * the lineup's starters, plus whoever has come on and minus whoever has gone off, over the WHOLE match: the phone has no
 * set-start lineup, so the referee owns position and re-entry (controller's ruling, F4). A side whose sheet marks no
 * starters (an older web) offers every player in both steps. A side with fewer than two named players cannot name a pair,
 * so the sub is recorded for the side alone, at once. Officials are never offered. Indoor only: beach records none, and
 * the pad offers no Sub there (`volleyballTools`).
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

type Swaps = Readonly<Record<PadSide, readonly VolleyballSwap[]>>;

/** The players on court and those not, each in the sheet's order; with no starters marked, everyone is in both. */
function courtOf(
  players: readonly VolleyballSheetPerson[],
  swaps: readonly VolleyballSwap[],
): {
  readonly court: readonly VolleyballSheetPerson[];
  readonly rest: readonly VolleyballSheetPerson[];
} {
  const starters = players.filter((one) => one.slot === 'starting');
  if (starters.length === 0) return { court: players, rest: players };
  const on = new Set(starters.map((one) => one.personId));
  for (const swap of swaps) {
    on.delete(swap.off);
    on.add(swap.on);
  }
  return {
    court: players.filter((one) => on.has(one.personId)),
    rest: players.filter((one) => !on.has(one.personId)),
  };
}

/** The first step, or the side's sub at once when it names too few players to pair. */
export function startSub(side: PadSide, people: VolleyballPeople): SubMove {
  if (playersOf(people[side]).length < 2) return { kind: 'record', tap: { kind: 'sub', side } };
  return { kind: 'step', step: { step: 'off', side } };
}

/** A choice the step does not offer leaves the step as it is, so a second press of one choice moves once. */
export function chooseSub(
  step: SubStep,
  choice: string,
  people: VolleyballPeople,
  swaps: Swaps,
): SubMove {
  const stay: SubMove = { kind: 'step', step };
  const { court, rest } = courtOf(playersOf(people[step.side]), swaps[step.side]);
  switch (step.step) {
    case 'off':
      return court.some((one) => one.personId === choice)
        ? { kind: 'step', step: { step: 'on', side: step.side, off: choice } }
        : stay;
    case 'on':
      return choice !== step.off && rest.some((one) => one.personId === choice)
        ? { kind: 'record', tap: { kind: 'sub', side: step.side, off: step.off, on: choice } }
        : stay;
  }
}

/** One step as a sheet asks it: the title, what is already chosen (the side, then who comes off), and the choices. */
export function subSheet(
  step: SubStep,
  people: VolleyballPeople,
  sides: Readonly<Record<PadSide, VolleyballSide>>,
  swaps: Swaps,
): SubSheet {
  const players = playersOf(people[step.side]);
  const { court, rest } = courtOf(players, swaps[step.side]);
  const option = (one: (typeof players)[number]): SanctionOption<VolleyballPadKey> => ({
    id: one.personId,
    label: one.name,
    tone: 'standard',
  });
  if (step.step === 'off') {
    return {
      title: { key: 'scoring.volleyball.sheet.off' },
      body: sideNames(sides[step.side]),
      options: court.map(option),
    };
  }
  const off = players.find((one) => one.personId === step.off);
  return {
    title: { key: 'scoring.volleyball.sheet.on' },
    body: off?.name ?? { key: 'scoring.volleyball.player' },
    options: rest.filter((one) => one.personId !== step.off).map(option),
  };
}
