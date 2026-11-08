import type { GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import type { FootballCfg } from '@seazn/engine/sports/football';
import type { ClockBarView } from '@/domain/scoring/clockBarView';
import { clockText, matchTime, PHASE_ORDER } from '@/domain/scoring/footballClock';
import { periodWordOf } from '@/domain/scoring/footballHistory';
import {
  playerLabel,
  playerMark,
  type FootballBreakWord,
  type FootballDisplay,
  type FootballPadKey,
  type FootballShootout,
  type FootballSide,
} from '@/domain/scoring/footballTypes';
import type { PadSide, PadStateCard, PadText } from '@/domain/scoring/padView';

/**
 * Football's own parts of the screen (S2-5 design §6.1–§6.5; plan P Task 8): the two team columns and their buttons,
 * the More sheet's items and the clock bar. Every button in a column acts for that column's team, so there is no team
 * step anywhere. What the engine allows decides what is offered; the screen draws it and decides nothing.
 */

type Text = PadText<FootballPadKey>;

const SIDES: readonly PadSide[] = ['first', 'second'];

/** One button in a column: its id names what it does and for whom (`goal.first`), and a disabled one may say why. */
export type BoardAction = {
  readonly id: string;
  readonly label: Text;
  /** Goal, the lime plate (AGENTS.md §5's primary); the others on `surface2`. */
  readonly primary: boolean;
  readonly enabled: boolean;
  /** The one line under a disabled button ("No subs left", "No team sheet"), or none. */
  readonly note: Text | null;
};

/** A player in the sin-bin, as the column's mark: who (`#6`), and when the bin is over (the engine's `expiresAt`). */
export type BoardBin = { readonly label: string; readonly over: GameTime | null };

export type BoardColumn = {
  readonly side: PadSide;
  readonly actions: readonly BoardAction[];
  readonly bins: readonly BoardBin[];
};

/**
 * The two columns, home first, and in the shootout each team's kicks in order (scored or not), for the ●/○ rows. In
 * play a column is Goal, Card and Sub; in the shootout (and once one has decided the match) Scored and Missed, live only
 * in the column whose kick the engine says is next, or in both before the first kick, which the engine leaves to the
 * teams. Nothing is live under a card, before the start or once the match is decided.
 */
export function footballBoard(
  display: FootballDisplay,
  card: PadStateCard | null,
): {
  readonly columns: readonly [BoardColumn, BoardColumn];
  readonly kicks: readonly [readonly boolean[], readonly boolean[]] | null;
} {
  const live = card === null && (display.phase === 'play' || display.phase === 'shootout');
  return {
    columns: [columnOf(display, 'first', live), columnOf(display, 'second', live)],
    kicks: kicksOf(display.shootout),
  };
}

function columnOf(display: FootballDisplay, side: PadSide, live: boolean): BoardColumn {
  const { shootout } = display;
  return {
    side,
    actions:
      shootout === null
        ? playActions(display, side, live)
        : kickActions(side, live && (shootout.next === null || shootout.next === side)),
    bins: binsOf(display.sides[side]),
  };
}

const action = (
  id: string,
  word: 'goal' | 'card' | 'sub' | 'scored' | 'missed',
  enabled: boolean,
  note: Text | null = null,
): BoardAction => ({
  id,
  label: { key: `scoring.football.column.${word}` },
  primary: word === 'goal',
  enabled,
  note,
});

/** Goal, Card and Sub. Sub says why it is off: the team has no sheet to name a player from, or no substitution left. */
function playActions(
  display: FootballDisplay,
  side: PadSide,
  live: boolean,
): readonly BoardAction[] {
  const subNote = subNoteOf(display, side);
  return [
    action(`goal.${side}`, 'goal', live),
    action(`card.${side}`, 'card', live),
    action(`sub.${side}`, 'sub', live && subNote === null, subNote),
  ];
}

function subNoteOf(display: FootballDisplay, side: PadSide): Text | null {
  if (!display.sides[side].sheet) return { key: 'scoring.football.column.noSheet' };
  return display.subsLeft[side] ? null : { key: 'scoring.football.column.noSubs' };
}

const kickActions = (side: PadSide, kicking: boolean): readonly BoardAction[] => [
  action(`scored.${side}`, 'scored', kicking),
  action(`missed.${side}`, 'missed', kicking),
];

const binsOf = (team: FootballSide): readonly BoardBin[] =>
  team.sinBin.map((binned) => ({
    label: binned.person === null ? '' : playerMark(binned.person),
    over: binned.expiresAt,
  }));

function kicksOf(
  shootout: FootballShootout | null,
): readonly [readonly boolean[], readonly boolean[]] | null {
  if (shootout === null) return null;
  const of = (side: PadSide) =>
    shootout.kicks.filter((kick) => kick.side === side).map((kick) => kick.scored);
  return [of('first'), of('second')];
}

const ACTIONS = ['goal', 'card', 'sub', 'scored', 'missed'] as const;

/** A column button's id read back: what it does and for which team; anything else is no button of the board. */
export function parseFootballAction(
  id: string,
): { readonly action: (typeof ACTIONS)[number]; readonly side: PadSide } | null {
  const [word, side, ...rest] = id.split('.');
  const known = ACTIONS.find((candidate) => candidate === word);
  const seat = SIDES.find((candidate) => candidate === side);
  return known === undefined || seat === undefined || rest.length > 0
    ? null
    : { action: known, side: seat };
}

// ---------------------------------------------------------------------------------------------------------------
// More
// ---------------------------------------------------------------------------------------------------------------

/** One item in the More sheet: its id names what it opens (`penalty.first`, `sinBinEnd.second.0`). */
export type MoreItem = { readonly id: string; readonly label: Text };

/**
 * The More sheet's items (design §6.4), each only while the engine takes its event in this phase: a missed penalty for
 * each team, a sin-bin for each when the match has sin-bins (`cfg.sinBinMinutes`, plan decision PD1), Back from sin-bin
 * for each player in the bin, a shot for each, Correct clock once the period's Start stands, and Match details always.
 */
export function footballMoreItems(display: FootballDisplay): readonly MoreItem[] {
  const takes = (type: string) =>
    footballPadRules.eventAllowedInPhase(type, display.enginePhase, display.cfg);
  const bins = display.cfg.sinBinMinutes !== undefined && takes('football.sinbin.start');
  return [
    ...(takes('football.penalty') ? perTeam(display, 'penalty') : []),
    ...(bins ? perTeam(display, 'sinBin') : []),
    ...(takes('football.sinbin.end') ? backItems(display) : []),
    ...(takes('football.shot') ? perTeam(display, 'shot') : []),
    ...(takes('football.clock') && display.clock.started
      ? [{ id: 'correct', label: more('correct') }]
      : []),
    { id: 'details', label: more('details') },
  ];
}

/**
 * Whether Correct is offered now, as More lists it (design §6.4, §7.5): while the engine takes a clock event and the
 * period's first Start stands (fix-round ruling e), so a break keeps its word and kick-off has no 0:00 to correct.
 */
export const footballTakesCorrect = (display: FootballDisplay): boolean =>
  footballMoreItems(display).some((item) => item.id === 'correct');

type MoreWord = 'penalty' | 'sinBin' | 'sinBinEnd' | 'shot' | 'correct' | 'details';

const more = (word: MoreWord, vars?: Readonly<Record<string, string>>): Text => ({
  key: `scoring.football.more.${word}`,
  ...(vars === undefined ? {} : { vars }),
});

const perTeam = (display: FootballDisplay, word: 'penalty' | 'sinBin' | 'shot'): MoreItem[] =>
  SIDES.map((side) => ({
    id: `${word}.${side}`,
    label: more(word, { team: display.sides[side].name }),
  }));

/** Back from sin-bin, one per player in the bin, named as the sheets name a player (the team, for a bin with no name). */
const backItems = (display: FootballDisplay): MoreItem[] =>
  SIDES.flatMap((side) =>
    display.sides[side].sinBin.map((binned, index) => ({
      id: `sinBinEnd.${side}.${index}`,
      label: more('sinBinEnd', {
        player: binned.person === null ? display.sides[side].name : playerLabel(binned.person),
      }),
    })),
  );

/**
 * Whether `side` leads (design §6.2: its score is the LED lime): more goals, or level on goals, more kicks scored in the
 * shootout. Level, neither does.
 */
export function footballLeads(display: FootballDisplay, side: PadSide): boolean {
  const other: PadSide = side === 'first' ? 'second' : 'first';
  const { goals, shootout } = display;
  if (goals[side] !== goals[other]) return goals[side] > goals[other];
  return shootout !== null && shootout.scored[side] > shootout.scored[other];
}

/** Whether a sin-bin ending at `over` is over at `now`: its end reached in its period, or any later period under way. */
export function binOver(over: GameTime | null, now: GameTime): boolean {
  if (over === null) return false;
  const rank = (period: string) => PHASE_ORDER.indexOf(period);
  if (now.period !== over.period) return rank(now.period) > rank(over.period);
  return now.elapsed >= over.elapsed;
}

// ---------------------------------------------------------------------------------------------------------------
// The clock bar
// ---------------------------------------------------------------------------------------------------------------

const PLAY: ReadonlySet<string> = new Set(footballPadRules.playPhases);

/**
 * The clock bar (design §6.1, §7.4): the face counted the way the match counts at `readingNow` (the shared clock's
 * reading, seconds within the period); outside play the face stops where the last stamp left it (the final whistle).
 * Under it the period, or the break's word while a period has ended and the clock has not started again; in the
 * shootout, Penalties. Start or Pause only while a period is in play.
 */
export function footballClockBar(
  display: FootballDisplay,
  readingNow: number,
): ClockBarView<FootballPadKey> {
  const { enginePhase, cfg } = display;
  const inPlay = PLAY.has(enginePhase);
  const at = inPlay
    ? { period: enginePhase, elapsed: readingNow }
    : (display.clock.asOf ?? { period: enginePhase, elapsed: 0 });
  const time = clockText(matchTime(at, cfg));
  const running = display.clock.anchor?.running === true;
  return {
    time,
    period: periodOf(display),
    said: { key: 'scoring.football.clock.said', vars: { time } },
    action: inPlay
      ? {
          kind: running ? 'pause' : 'start',
          label: { key: running ? 'scoring.football.clock.pause' : 'scoring.football.clock.start' },
        }
      : null,
  };
}

/** Correct's time (design §7.5): `seconds` into the period in play, counted the way the match counts (`matchTime` reads a negative as 0:00 of it). */
export function footballCorrectTime(display: FootballDisplay, seconds: number): string {
  const at = { period: display.enginePhase, elapsed: seconds };
  return clockText(matchTime(at, display.cfg));
}

function periodOf(display: FootballDisplay): Text | null {
  if (display.phase === 'shootout') return { key: 'scoring.football.period.shootout' };
  const { justEnded } = display.clock;
  const ended = justEnded === null ? null : breakWordOf(justEnded, display.cfg);
  if (ended !== null) return { key: `scoring.football.break.${ended}` };
  const word = periodWordOf(display.enginePhase, display.cfg);
  return word === null ? null : { key: `scoring.football.period.${word}` };
}

/** What follows each period: half-time after the first half, or after the second quarter; full time after the last. */
const BREAK_AFTER: Readonly<Record<string, FootballBreakWord>> = {
  H1: 'halfTime',
  Q2: 'halfTime',
  Q3: 'quarterTime',
  H2: 'fullTime',
  Q4: 'fullTime',
  ET_H1: 'etHalfTime',
  ET_H2: 'fullTime',
};

/** The break after `period` under `cfg`: H1 is the first quarter in a match of quarters, so a quarter-time follows it. */
function breakWordOf(period: string, cfg: FootballCfg): FootballBreakWord | null {
  if (period === 'H1' && cfg.halves === 4) return 'quarterTime';
  return BREAK_AFTER[period] ?? null;
}
