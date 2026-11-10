import type { GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import { footballMoreItems, parseFootballAction } from '@/domain/scoring/footballBoard';
import { footballOptions } from '@/domain/scoring/footballEngine';
import {
  otherSide,
  playerLabel,
  type FootballCardWord,
  type FootballDisplay,
  type FootballOutcomeWord,
  type FootballPadKey,
  type FootballPlayer,
  type FootballSide,
  type FootballTap,
} from '@/domain/scoring/footballTypes';
import type { PadSide, PadText, PadVar } from '@/domain/scoring/padView';

/**
 * Football's step sheets, pure (S2-5 design §6.3–§6.6, ruling 106): what each step asks and offers, and what a choice
 * does, the next step or the one tap the sheet records. Every button in a column acts for that column's team, so no step
 * asks for a team. The stamp is the clock's reading when the button that opened the sheet was pressed, carried to the
 * tap. A team with no team sheet (§6.6) is asked for no player. The hook holds the step on screen; the screen draws it.
 */

/** The reasons for a card the engine lists (`footballPadRules.cardReasons`), each with its words. */
export type FootballReasonWord =
  | 'unsporting_behaviour'
  | 'dissent'
  | 'persistent_offences'
  | 'delaying_restart'
  | 'failure_to_respect_distance'
  | 'entering_or_leaving_without_permission'
  | 'serious_foul_play'
  | 'violent_conduct'
  | 'spitting'
  | 'denying_goal_by_handball'
  | 'denying_obvious_goalscoring_opportunity'
  | 'offensive_language'
  | 'second_caution';

const REASONS: readonly FootballReasonWord[] = [
  'unsporting_behaviour',
  'dissent',
  'persistent_offences',
  'delaying_restart',
  'failure_to_respect_distance',
  'entering_or_leaving_without_permission',
  'serious_foul_play',
  'violent_conduct',
  'spitting',
  'denying_goal_by_handball',
  'denying_obvious_goalscoring_opportunity',
  'offensive_language',
  'second_caution',
];

type SheetWord =
  | 'whoScored'
  | 'ownGoal'
  | 'dontKnow'
  | 'penalty'
  | 'assist'
  | 'noAssist'
  | 'whoPutItIn'
  | 'yellow'
  | 'red'
  | 'secondYellow'
  | 'bench'
  | 'reason'
  | 'noReason'
  | 'whoComesOff'
  | 'whoComesOn'
  | 'whoKicked'
  | 'whoTookIt'
  | 'goalkeeper'
  | 'outcome';

/** Every dictionary key a football step names. */
export type FootballSheetKey =
  | `scoring.football.sheet.${SheetWord}`
  | `scoring.football.card.${FootballCardWord}`
  | `scoring.football.reason.${FootballReasonWord}`
  | `scoring.football.outcome.${FootballOutcomeWord}`
  | FootballPadKey;

export type FootballStepOption = {
  readonly id: string;
  readonly label: PadVar<FootballSheetKey>;
  readonly tone: 'standard' | 'destructive';
  readonly kind?: 'choice' | 'heading' | 'toggle';
  readonly checked?: boolean;
  /** A second line under the label (a yellowed player's "2nd yellow · sent off"). */
  readonly note?: PadText<FootballSheetKey> | null;
};

/** One step on screen: its title, what is already chosen, and its choices (the kit's `StepSheetFacts`). */
export type FootballStepSheet = {
  readonly title: PadText<FootballSheetKey>;
  readonly body: PadVar<FootballSheetKey> | null;
  readonly options: readonly FootballStepOption[];
};

type Stamp = GameTime | null;

/** The sheet in progress: which flow, for which column's team, at which step, and what is chosen so far. */
export type FootballFlow =
  | {
      readonly kind: 'goal';
      readonly side: PadSide;
      readonly stamp: Stamp;
      readonly step: 'scorer' | 'assist' | 'ownGoal';
      readonly penalty: boolean;
      readonly scorer: string | null;
    }
  | {
      readonly kind: 'card';
      readonly side: PadSide;
      readonly stamp: Stamp;
      readonly step: 'player' | 'reason';
      /** The colour the button named; a Yellow on a player already yellowed becomes a second yellow at the player step. */
      readonly color: FootballCardWord;
      readonly person: string | null;
    }
  | {
      readonly kind: 'sub';
      readonly side: PadSide;
      readonly step: 'off' | 'on';
      readonly off: string | null;
    }
  | { readonly kind: 'kick'; readonly side: PadSide; readonly scored: boolean }
  | {
      readonly kind: 'penalty';
      readonly side: PadSide;
      readonly stamp: Stamp;
      readonly step: 'taker' | 'goalkeeper' | 'outcome';
      readonly taker: string | null;
      readonly goalkeeper: string | null;
    }
  | {
      readonly kind: 'sinBin';
      readonly side: PadSide;
      readonly stamp: Stamp;
      readonly step: 'player' | 'reason';
      readonly person: string | null;
    }
  | {
      readonly kind: 'shot';
      readonly side: PadSide;
      readonly stamp: Stamp;
      readonly step: 'taker' | 'outcome';
      readonly taker: string | null;
    }
  | { readonly kind: 'more' };

/** What a press or a choice does: shows a step, records the one tap, opens Correct or Match details, or nothing. */
export type FootballMove =
  | { readonly kind: 'flow'; readonly flow: FootballFlow }
  | { readonly kind: 'tap'; readonly tap: FootballTap }
  | { readonly kind: 'other'; readonly id: 'correct' | 'details' }
  | { readonly kind: 'stay' };

export const MORE_FLOW: FootballFlow = { kind: 'more' };

const STAY: FootballMove = { kind: 'stay' };
const flow = (next: FootballFlow): FootballMove => ({ kind: 'flow', flow: next });
const tap = (made: FootballTap): FootballMove => ({ kind: 'tap', tap: made });

/** The step a flow is at, as a name: the bounce window of a step appearing is per name. */
export function footballStepName(current: FootballFlow): string {
  return 'step' in current ? `${current.kind}.${current.step}` : current.kind;
}

// ---------------------------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------------------------

/**
 * A column's button pressed (`goal.first`): its first step, or, for a team with no team sheet, the tap at once (a goal or
 * a kick names no player, §6.6). Sub has nothing to offer such a team (the board disables it).
 */
export function footballOpen(id: string, display: FootballDisplay, stamp: Stamp): FootballMove {
  const parsed = parseFootballAction(id);
  if (parsed === null) return STAY;
  const { action, side } = parsed;
  const { sheet } = display.sides[side];
  switch (action) {
    case 'goal':
      return sheet
        ? flow({ kind: 'goal', side, stamp, step: 'scorer', penalty: false, scorer: null })
        : tap({ kind: 'goal', side, scorer: null, assist: null, penalty: false, stamp });
    case 'yellow':
    case 'red':
      return flow({
        kind: 'card',
        side,
        stamp,
        step: sheet ? 'player' : 'reason',
        color: action,
        person: null,
      });
    case 'sub':
      return sheet ? flow({ kind: 'sub', side, step: 'off', off: null }) : STAY;
    case 'scored':
    case 'missed': {
      const scored = action === 'scored';
      return sheet
        ? flow({ kind: 'kick', side, scored })
        : tap({ kind: 'kick', side, person: null, scored });
    }
  }
}

/** A More item chosen (`penalty.first`, `sinBinEnd.second.0`, `correct`): one the sheet offers (`footballChoose` checks). */
function moreItem(id: string, display: FootballDisplay, stamp: Stamp): FootballMove {
  if (id === 'correct' || id === 'details') return { kind: 'other', id };
  const [word, seat, index] = id.split('.');
  const side: PadSide = seat === 'second' ? 'second' : 'first';
  const team = display.sides[side];
  if (word === 'penalty' || word === 'sinBin' || word === 'shot') {
    return flow(moreFlow(word, side, stamp, display));
  }
  return backFromBin(side, team, Number(index), stamp);
}

/** The flow a More item for a team opens, at its first step: a player's where the team has a sheet. */
function moreFlow(
  word: 'penalty' | 'sinBin' | 'shot',
  side: PadSide,
  stamp: Stamp,
  display: FootballDisplay,
): FootballFlow {
  const sheet = display.sides[side].sheet;
  switch (word) {
    case 'penalty': {
      const step = penaltyFirstStep(display, side);
      return { kind: 'penalty', side, stamp, step, taker: null, goalkeeper: null };
    }
    case 'sinBin':
      return { kind: 'sinBin', side, stamp, step: sheet ? 'player' : 'reason', person: null };
    case 'shot':
      return { kind: 'shot', side, stamp, step: sheet ? 'taker' : 'outcome', taker: null };
  }
}

function penaltyFirstStep(
  display: FootballDisplay,
  side: PadSide,
): 'taker' | 'goalkeeper' | 'outcome' {
  if (display.sides[side].sheet) return 'taker';
  return display.sides[otherSide(side)].sheet ? 'goalkeeper' : 'outcome';
}

/** Back from the sin-bin is the scorer's tap, at once: the player (or nobody named) the item stood for. */
function backFromBin(side: PadSide, team: FootballSide, index: number, stamp: Stamp): FootballMove {
  const binned = team.sinBin[index];
  if (binned === undefined) return STAY;
  return tap({ kind: 'sinBinEnd', side, person: binned.person?.personId ?? null, stamp });
}

// ---------------------------------------------------------------------------------------------------------------
// The step on screen
// ---------------------------------------------------------------------------------------------------------------

export function footballStep(current: FootballFlow, display: FootballDisplay): FootballStepSheet {
  switch (current.kind) {
    case 'goal':
      return goalStep(current, display);
    case 'card':
      return cardStep(current, display);
    case 'sub':
      return subStep(current, display);
    case 'kick':
      return {
        title: sheetText('whoKicked', teamOf(display, current.side)),
        body: null,
        options: [...playerOptions(display.sides[current.side].onPitch), word('dontKnow')],
      };
    case 'penalty':
      return penaltyStep(current, display);
    case 'sinBin':
      return sinBinStep(current, display);
    case 'shot':
      return shotStep(current, display);
    case 'more':
      return moreStep(display);
  }
}

type Flow<K extends FootballFlow['kind']> = Extract<FootballFlow, { readonly kind: K }>;

const sheetText = (
  key: SheetWord,
  vars?: Readonly<Record<string, string>>,
): PadText<FootballSheetKey> => ({
  key: `scoring.football.sheet.${key}`,
  ...(vars === undefined ? {} : { vars }),
});

const teamOf = (display: FootballDisplay, side: PadSide) => ({ team: display.sides[side].name });

const word = (
  key: SheetWord,
  tone: FootballStepOption['tone'] = 'standard',
): FootballStepOption => ({
  id: key,
  label: sheetText(key),
  tone,
});

const PLAYER = 'p.';

const playerOptions = (players: readonly FootballPlayer[]): FootballStepOption[] =>
  players.map((player) => ({
    id: `${PLAYER}${player.personId}`,
    label: playerLabel(player),
    tone: 'standard',
  }));

/** The player a choice names, if it is one of `players`. */
const playerChosen = (players: readonly FootballPlayer[], id: string): string | null =>
  players.find((player) => `${PLAYER}${player.personId}` === id)?.personId ?? null;

/** A person's label, as the sheets name a player, for the step that says who is chosen. */
function labelOf(team: FootballSide, personId: string | null): string | null {
  if (personId === null) return null;
  const known = [...team.onPitch, ...team.cardable, ...team.bench];
  const player = known.find((candidate) => candidate.personId === personId);
  return player === undefined ? null : playerLabel(player);
}

function goalStep(current: Flow<'goal'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  const other = display.sides[otherSide(current.side)];
  if (current.step === 'assist') {
    return {
      title: sheetText('assist'),
      body: labelOf(team, current.scorer),
      options: [
        ...playerOptions(team.onPitch.filter((p) => p.personId !== current.scorer)),
        word('noAssist'),
      ],
    };
  }
  if (current.step === 'ownGoal') {
    return {
      title: sheetText('whoPutItIn'),
      body: null,
      options: [...playerOptions(other.onPitch), word('dontKnow')],
    };
  }
  return scorerStep(current, team, other);
}

/** Who scored: Penalty as a switch, the team's players on the pitch, Own goal (by the other team) and Don't know. */
function scorerStep(
  current: Flow<'goal'>,
  team: FootballSide,
  other: FootballSide,
): FootballStepSheet {
  const penalty: FootballStepOption = {
    ...word('penalty'),
    kind: 'toggle',
    checked: current.penalty,
  };
  const ownGoal = {
    id: 'ownGoal',
    label: sheetText('ownGoal', { team: other.name }),
    tone: 'standard',
  } as const;
  return {
    title: sheetText('whoScored', { team: team.name }),
    body: null,
    options: [penalty, ...playerOptions(team.onPitch), ownGoal, word('dontKnow')],
  };
}

const colourText = (color: FootballCardWord): PadText<FootballSheetKey> => ({
  key: `scoring.football.card.${color}`,
});

function cardStep(current: Flow<'card'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  if (current.step === 'player') {
    const word = current.color === 'red' ? 'red' : 'yellow';
    return {
      title: sheetText(word, { team: team.name }),
      body: null,
      options: bookingOptions(team, current.color === 'yellow'),
    };
  }
  return {
    title: sheetText('reason'),
    body: labelOf(team, current.person) ?? colourText(current.color),
    options: reasonOptions(),
  };
}

/** The players on the pitch first, then everyone else bookable under a "Bench" heading. */
/** `noting`: a Yellow's list says which players are already on a yellow, whose next one is a sending-off. */
function bookingOptions(team: FootballSide, noting: boolean): FootballStepOption[] {
  const onPitch = new Set(team.onPitch.map((player) => player.personId));
  const first = team.cardable.filter((player) => onPitch.has(player.personId));
  const rest = team.cardable.filter((player) => !onPitch.has(player.personId));
  const bench: FootballStepOption = { ...word('bench'), id: 'heading.bench', kind: 'heading' };
  const noted = (players: readonly FootballPlayer[]) =>
    playerOptions(players).map((option, at) =>
      noting && team.yellowed.includes(players[at]!.personId)
        ? { ...option, note: sheetText('secondYellow') }
        : option,
    );
  return [...noted(first), ...(rest.length > 0 ? [bench, ...noted(rest)] : [])];
}

/** No reason first, then the engine's reasons. */
const reasonOptions = (): FootballStepOption[] => [
  word('noReason'),
  ...REASONS.filter((reason) => footballPadRules.cardReasons.includes(reason)).map((reason) => ({
    id: `reason.${reason}`,
    label: { key: `scoring.football.reason.${reason}` } as const,
    tone: 'standard' as const,
  })),
];

function subStep(current: Flow<'sub'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  if (current.step === 'off' || current.off === null) {
    return {
      title: sheetText('whoComesOff', { team: team.name }),
      body: null,
      options: playerOptions(team.onPitch),
    };
  }
  return {
    title: sheetText('whoComesOn', { player: labelOf(team, current.off) ?? team.name }),
    body: null,
    options: playerOptions(team.offeredOn),
  };
}

const OUTCOMES: readonly FootballOutcomeWord[] = ['saved', 'missed', 'post', 'blocked', 'scored'];

const outcomeOptions = (listed: readonly string[]): FootballStepOption[] =>
  OUTCOMES.filter((outcome) => listed.includes(outcome)).map((outcome) => ({
    id: `outcome.${outcome}`,
    label: { key: `scoring.football.outcome.${outcome}` },
    tone: 'standard',
  }));

function penaltyStep(current: Flow<'penalty'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  const other = display.sides[otherSide(current.side)];
  if (current.step === 'taker') {
    return {
      title: sheetText('whoTookIt', { team: team.name }),
      body: null,
      options: [...playerOptions(team.onPitch), word('dontKnow')],
    };
  }
  if (current.step === 'goalkeeper') {
    return {
      title: sheetText('goalkeeper'),
      body: null,
      options: [...playerOptions(other.onPitch), word('dontKnow')],
    };
  }
  return {
    title: sheetText('outcome'),
    body: null,
    options: outcomeOptions(footballPadRules.penaltyOutcomes),
  };
}

function sinBinStep(current: Flow<'sinBin'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  if (current.step === 'player') {
    return {
      title: { key: 'scoring.football.more.sinBin', vars: { team: team.name } },
      body: null,
      options: playerOptions(team.onPitch),
    };
  }
  return {
    title: sheetText('reason'),
    body: labelOf(team, current.person),
    options: reasonOptions(),
  };
}

function shotStep(current: Flow<'shot'>, display: FootballDisplay): FootballStepSheet {
  const team = display.sides[current.side];
  if (current.step === 'taker') {
    return {
      title: sheetText('whoTookIt', { team: team.name }),
      body: null,
      options: [...playerOptions(team.onPitch), word('dontKnow')],
    };
  }
  return {
    title: sheetText('outcome'),
    body: labelOf(team, current.taker),
    options: outcomeOptions(footballOptions('football.shot', 'outcome')),
  };
}

function moreStep(display: FootballDisplay): FootballStepSheet {
  return {
    title: { key: 'scoring.football.tool.more' },
    body: null,
    options: footballMoreItems(display).map((item) => ({
      id: item.id,
      label: item.label,
      tone: 'standard',
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A choice
// ---------------------------------------------------------------------------------------------------------------

/**
 * A choice on the step on screen: the next step, or the one tap the sheet records. A choice the step does not offer does
 * nothing (`stay`). `stamp` is the reading now, taken only by a More item, which opens its own flow.
 */
export function footballChoose(
  current: FootballFlow,
  id: string,
  display: FootballDisplay,
  stamp: Stamp,
): FootballMove {
  if (!footballStep(current, display).options.some((option) => option.id === id)) return STAY;
  switch (current.kind) {
    case 'goal':
      return chooseGoal(current, id, display);
    case 'card':
      return chooseCard(current, id, display);
    case 'sub':
      return chooseSub(current, id, display);
    case 'kick':
      return chooseKick(current, id, display);
    case 'penalty':
      return choosePenalty(current, id, display);
    case 'sinBin':
      return chooseSinBin(current, id, display);
    case 'shot':
      return chooseShot(current, id, display);
    case 'more':
      return moreItem(id, display, stamp);
  }
}

/** A kick's taker chosen (or not known): the kick, scored or missed as its column said. */
function chooseKick(current: Flow<'kick'>, id: string, display: FootballDisplay): FootballMove {
  const person = playerChosen(display.sides[current.side].onPitch, id);
  return tap({ kind: 'kick', side: current.side, person, scored: current.scored });
}

function chooseGoal(current: Flow<'goal'>, id: string, display: FootballDisplay): FootballMove {
  const { side, stamp, penalty } = current;
  const team = display.sides[side];
  if (current.step === 'ownGoal') {
    const scorer = playerChosen(display.sides[otherSide(side)].onPitch, id);
    return tap({ kind: 'ownGoal', side, scorer, stamp });
  }
  if (current.step === 'assist') {
    const assist = playerChosen(team.onPitch, id);
    return tap({ kind: 'goal', side, scorer: current.scorer, assist, penalty: false, stamp });
  }
  if (id === 'penalty') return flow({ ...current, penalty: !penalty });
  if (id === 'ownGoal') return flow({ ...current, step: 'ownGoal' });
  const scorer = playerChosen(team.onPitch, id);
  // A penalty has no assist, and nor has a goal nobody is named for (the controller's, §6.3).
  if (penalty || scorer === null) {
    return tap({ kind: 'goal', side, scorer, assist: null, penalty, stamp });
  }
  return flow({ ...current, step: 'assist', scorer });
}

function chooseCard(current: Flow<'card'>, id: string, display: FootballDisplay): FootballMove {
  const team = display.sides[current.side];
  if (current.step === 'player') {
    const person = playerChosen(team.cardable, id);
    // A yellow shown to a player already yellowed is the second one: a sending-off.
    const second = current.color === 'yellow' && person !== null && team.yellowed.includes(person);
    const color: FootballCardWord = second ? 'second_yellow' : current.color;
    return flow({ ...current, step: 'reason', person, color });
  }
  const { side, person, color, stamp } = current;
  return tap({ kind: 'card', side, person, color, reason: reasonChosen(id), stamp });
}

const reasonChosen = (id: string): string | null =>
  REASONS.find((reason) => id === `reason.${reason}`) ?? null;

function chooseSub(current: Flow<'sub'>, id: string, display: FootballDisplay): FootballMove {
  const team = display.sides[current.side];
  if (current.step === 'off' || current.off === null) {
    const off = playerChosen(team.onPitch, id);
    return off === null ? STAY : flow({ ...current, step: 'on', off });
  }
  const on = playerChosen(team.offeredOn, id);
  return on === null ? STAY : tap({ kind: 'sub', side: current.side, off: current.off, on });
}

const outcomeChosen = (id: string): string => id.slice('outcome.'.length);

function choosePenalty(
  current: Flow<'penalty'>,
  id: string,
  display: FootballDisplay,
): FootballMove {
  const other = display.sides[otherSide(current.side)];
  if (current.step === 'taker') {
    const taker = playerChosen(display.sides[current.side].onPitch, id);
    return flow({ ...current, taker, step: other.sheet ? 'goalkeeper' : 'outcome' });
  }
  if (current.step === 'goalkeeper') {
    return flow({ ...current, goalkeeper: playerChosen(other.onPitch, id), step: 'outcome' });
  }
  const { side, taker, goalkeeper, stamp } = current;
  return tap({ kind: 'penaltyMiss', side, taker, goalkeeper, outcome: outcomeChosen(id), stamp });
}

function chooseSinBin(current: Flow<'sinBin'>, id: string, display: FootballDisplay): FootballMove {
  if (current.step === 'player') {
    const person = playerChosen(display.sides[current.side].onPitch, id);
    return flow({ ...current, person, step: 'reason' });
  }
  const { side, person, stamp } = current;
  return tap({ kind: 'sinBin', side, person, reason: reasonChosen(id), stamp });
}

function chooseShot(current: Flow<'shot'>, id: string, display: FootballDisplay): FootballMove {
  if (current.step === 'taker') {
    const taker = playerChosen(display.sides[current.side].onPitch, id);
    return flow({ ...current, taker, step: 'outcome' });
  }
  const { side, taker, stamp } = current;
  return tap({ kind: 'shot', side, taker, outcome: outcomeChosen(id), stamp });
}
