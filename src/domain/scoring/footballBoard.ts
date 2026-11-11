import type { GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import type { FootballCfg } from '@seazn/engine/sports/football';
import type { ClockBarAction, ClockBarView } from '@/domain/scoring/clockBarView';
import {
  clockText,
  joinsStoppage,
  matchTime,
  PHASE_ORDER,
  stampFor,
} from '@/domain/scoring/footballClock';
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
  /** Goal, or Scored in the shootout: the lime square that carries the team's score (owner ruling 132); the others on `surface2`. */
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
 * play a column is Goal, Yellow, Red and Sub; in the shootout (and once one has decided the match) Scored and Missed, live only
 * in the column whose kick the engine says is next, or in both before the first kick, which the engine leaves to the
 * teams. Nothing is live under a card, before the start or once the match is decided.
 */
export function footballBoard(
  display: FootballDisplay,
  card: PadStateCard<string> | null,
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
  word: 'goal' | 'yellow' | 'red' | 'sub' | 'scored' | 'missed',
  enabled: boolean,
  note: Text | null = null,
): BoardAction => ({
  id,
  label: { key: `scoring.football.column.${word}` },
  primary: word === 'goal' || word === 'scored',
  enabled,
  note,
});

/**
 * Goal, Yellow, Red and Sub. Sub says why it is off: the team has no sheet to name a player from, or no substitution
 * left. It stays on while the team has an ordinary sub or its concussion exemption left (ruling 155); with only the
 * concussion left it still reads No subs left, and its sheet offers Normal sub disabled.
 */
function playActions(
  display: FootballDisplay,
  side: PadSide,
  live: boolean,
): readonly BoardAction[] {
  const subNote = subNoteOf(display, side);
  const { sheet } = display.sides[side];
  const subOn = sheet && (display.subsLeft[side] || display.concussionLeft[side]);
  return [
    action(`goal.${side}`, 'goal', live),
    action(`yellow.${side}`, 'yellow', live),
    action(`red.${side}`, 'red', live),
    action(`sub.${side}`, 'sub', live && subOn, subNote),
  ];
}

function subNoteOf(display: FootballDisplay, side: PadSide): Text | null {
  if (!display.sides[side].sheet) return { key: 'scoring.football.column.noSheet' };
  return display.subsLeft[side] ? null : { key: 'scoring.football.column.noSubs' };
}

/**
 * The display with `subsLeft` asked again with the stamp a sub pressed `now` would get (ruling 154): joining the stoppage
 * while the reading is no more than 120 s past it, else a window of its own (`now` null: no reading, a sub unstamped).
 * The display itself when nothing changes, so a memo over it holds.
 */
export function footballSubsNow(display: FootballDisplay, now: GameTime | null): FootballDisplay {
  return footballSubsJoining(display, subJoinsNow(display, now));
}

/** Whether a sub pressed at the reading `now` joins the display's stoppage (`joinsStoppage`, ruling 154). */
export function subJoinsNow(display: FootballDisplay, now: GameTime | null): boolean {
  const { enginePhase, clock } = display;
  return joinsStoppage(clock.stoppage, stampFor(now, enginePhase, clock.asOf));
}

/** The display with `subsLeft` as a sub that joins the stoppage (`joining`) or opens a window of its own would find it. */
export function footballSubsJoining(display: FootballDisplay, joining: boolean): FootballDisplay {
  const { subsLeftAt, subsLeft } = display;
  const left = joining ? subsLeftAt.joining : subsLeftAt.fresh;
  return left.first === subsLeft.first && left.second === subsLeft.second
    ? display
    : { ...display, subsLeft: left };
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

const ACTIONS = ['goal', 'yellow', 'red', 'sub', 'scored', 'missed'] as const;

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
 * for each player in the bin, a shot for each, Adjust clock once the period's Start stands, and Match details always.
 * In the shootout, a Yellow card and a Red card for each team (the controller's ruling 156): the columns there are Scored
 * and Missed, so a booking during the kicks is made from More.
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
    ...(display.phase === 'shootout' && takes('football.card') ? cardItems(display) : []),
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

/** A Yellow card and a Red card for each team, worded as the card sheets' titles (`Yellow card · {team}`). */
const cardItems = (display: FootballDisplay): MoreItem[] =>
  SIDES.flatMap((side) =>
    (['yellow', 'red'] as const).map((color) => ({
      id: `${color}.${side}`,
      label: {
        key: `scoring.football.sheet.${color}` as const,
        vars: { team: display.sides[side].name },
      },
    })),
  );

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
  const paused = inPlay && !running && display.clock.started;
  return {
    time,
    period: periodOf(display),
    said: { key: 'scoring.football.clock.said', vars: { time } },
    paused: paused ? { key: 'scoring.football.clock.paused' } : null,
    action: inPlay ? plateOf(running, paused) : null,
  };
}

/** The plate: Pause while running; else Resume once the period's first start stands, and Start before it. */
function plateOf(running: boolean, paused: boolean): ClockBarAction<FootballPadKey> {
  if (running) return { kind: 'pause', label: { key: 'scoring.football.clock.pause' } };
  if (paused) return { kind: 'resume', label: { key: 'scoring.football.clock.resume' } };
  return { kind: 'start', label: { key: 'scoring.football.clock.start' } };
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
