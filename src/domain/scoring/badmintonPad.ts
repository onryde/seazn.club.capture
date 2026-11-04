import type { MatchContext } from '@/domain/scoring/matchContext';
import {
  badmintonRuleRows,
  type BadmintonRuleKey,
  type BadmintonRules,
} from '@/domain/scoring/badmintonRules';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadMatchDetails,
  type PadPeriods,
  type PadPeriodScore,
  type PadServing,
  type PadSide,
  type PadStart,
  type PadStripItem,
  type PadSync,
  type PadTally,
  type PadText,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';
import type { SetBasedPhase } from '@/domain/scoring/setBasedBoard';
import { scoreText, sideNames, type SetBasedSide } from '@/domain/scoring/setBasedSides';

/** The web's four sanction levels (`sanction.*`), lightest first. */
export type BadmintonSanctionLevel = 'warning' | 'penalty' | 'expulsion' | 'disqualification';
export const SANCTION_LEVELS: readonly BadmintonSanctionLevel[] = [
  'warning',
  'penalty',
  'expulsion',
  'disqualification',
];

/** A side's players as the organiser typed them: one in singles, two in doubles. */
export type BadmintonSide = SetBasedSide;

export type BadmintonSanction = {
  readonly side: PadSide;
  readonly level: BadmintonSanctionLevel;
  readonly person: string;
};

/**
 * One tap the scorer can make on the pad. `start` starts the match, the side picked serving first (owner, 2026-11-01);
 * `ending` is a disqualification's: the match ends, the other side wins.
 */
export type BadmintonTap =
  | { readonly kind: 'start'; readonly server: PadSide }
  | { readonly kind: 'rally'; readonly side: PadSide }
  | ({ readonly kind: 'sanction' } & BadmintonSanction)
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'ending'; readonly side: PadSide; readonly person: string };

/**
 * A tap Undo took back, as the last-tap line names it: never the start, whose Undo returns to the Start screen, where
 * no line shows (owner, 2026-11-01).
 */
export type BadmintonUndoneTap = Exclude<BadmintonTap, { readonly kind: 'start' }>;

/**
 * What the last tap did: a rally says whether it won a game or the match; `undone` names the tap Undo took back. The
 * start names its first server when the ledger or this phone's pick says it, else null (a match started elsewhere).
 */
export type BadmintonLastTap =
  | { readonly kind: 'start'; readonly server: PadSide | null }
  | {
      readonly kind: 'rally';
      readonly side: PadSide;
      readonly won: 'none' | 'game' | 'match';
      readonly game: number;
    }
  | ({ readonly kind: 'sanction' } & BadmintonSanction)
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'ending'; readonly side: PadSide; readonly person: string }
  | { readonly kind: 'undone'; readonly tap: BadmintonUndoneTap };

/** What a tap did when it was recorded: the last-tap line's tap, never an Undo (History lists Undo on the tap it took). */
export type BadmintonDone = Exclude<BadmintonLastTap, { readonly kind: 'undone' }>;

/**
 * A game over: each side's points when it ended, and the side that won it on points, or the side whose
 * disqualification ended it and the match (owner ruling 18, 2026-10-31), which no side won on points.
 */
export type BadmintonGame =
  | { readonly points: Readonly<Record<PadSide, number>>; readonly winner: PadSide }
  | { readonly points: Readonly<Record<PadSide, number>>; readonly disqualified: PadSide };

/**
 * Not started (the Start screen: who serves first is not yet picked); started, before the match's first rally; a game
 * under way; a game won and the next not yet started; the match over.
 */
export type BadmintonPhase = SetBasedPhase;

/**
 * A badminton match as the pad shows it. Whoever keeps the score (the engine in S2; the preview's fake today) decides
 * every field: this file only draws them.
 */
export type BadmintonDisplay = {
  readonly sides: Readonly<Record<PadSide, BadmintonSide>>;
  /** Where the match sits: competition, division, round, the fixture's code, the sides (owner, 2026-11-01). */
  readonly context: MatchContext;
  /** The game under way, or about to start; the last one's final score once the match is decided. */
  readonly points: Readonly<Record<PadSide, number>>;
  /**
   * Every game over, in order (owner ruling 16): a game won on a rally, the match's last one included, and the game a
   * recorded disqualification ended (owner ruling 18), at its points then.
   */
  readonly finished: readonly BadmintonGame[];
  /**
   * The side due to serve, or null when the ledger does not say: a set score moved the points with no rally since (the
   * engine's `score-jumped`), or the match was started elsewhere and has had no rally. Null draws no serving plate.
   */
  readonly server: PadSide | null;
  /** The server's service court; nothing reads it while `server` is null. */
  readonly court: BadmintonCourt;
  /** The game under way, or about to start; the last one once decided. */
  readonly game: number;
  /** The match's config: the strip's format and interval, and the Match details' rules table (`badmintonRuleRows`). */
  readonly rules: BadmintonRules;
  readonly phase: BadmintonPhase;
  readonly sanctions: readonly BadmintonSanction[];
  readonly lastTap: BadmintonLastTap | null;
  /** This phone has a tap of its own that Undo can take back (owner, 2026-10-31: one Undo, own taps only). */
  readonly undoable: boolean;
  /** A disqualification is recorded and its ending not yet chosen: record it, or void the sanction. */
  readonly awaitingEnding: boolean;
  /**
   * The server shown is this phone's pick on the Start screen, the ledger having named nobody yet: the match's first
   * rally carries it as `serving` (design §7.3). False whenever the server comes from the ledger, or is not known.
   */
  readonly serverPicked: boolean;
};

/** Every dictionary key this file names. The kit translates them as `MessageKey`, so each must exist in en.json. */
export type BadmintonPadKey =
  | 'scoring.badminton.gamesSaid.other'
  | 'scoring.badminton.gamesTally'
  | 'scoring.badminton.gameSaid.disqualified'
  | 'scoring.badminton.gameSaid.stopped'
  | 'scoring.badminton.mark.disqualified'
  | 'scoring.badminton.hint'
  | 'scoring.badminton.hintLine'
  | 'scoring.badminton.gameOf'
  | 'scoring.badminton.gameHeading'
  | `scoring.badminton.serving.${BadmintonCourt}`
  | `scoring.badminton.servingSaid.${BadmintonCourt}`
  | 'scoring.badminton.intervalAt'
  | 'scoring.badminton.intervalNow'
  | 'scoring.badminton.start.ask'
  | 'scoring.badminton.last.start'
  | 'scoring.badminton.last.startUnknownServer'
  | 'scoring.badminton.last.rally'
  | 'scoring.badminton.last.game'
  | 'scoring.badminton.last.match'
  | 'scoring.badminton.last.sanction'
  | 'scoring.badminton.last.setScore'
  | 'scoring.badminton.last.ending'
  | 'scoring.badminton.undone.rally'
  | 'scoring.badminton.undone.sanction'
  | 'scoring.badminton.undone.setScore'
  | 'scoring.badminton.undone.ending'
  | 'scoring.badminton.tool.sanction'
  | 'scoring.badminton.tool.setScore'
  | BadmintonRuleKey
  | SanctionLevelKey;

export type SanctionLevelKey = `scoring.sanction.${BadmintonSanctionLevel}`;

/** The server's service court. */
export type BadmintonCourt = 'left' | 'right';

type Text = PadText<BadmintonPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** A sanction level's word (the web's `sanction.*`). */
export function sanctionWord(level: BadmintonSanctionLevel): PadText<SanctionLevelKey> {
  return { key: `scoring.sanction.${level}` };
}

/**
 * Layout A's pad for a badminton match (owner rulings, 2026-10-31): the first side on top, the second below, each with
 * its finished games' scores and its heaviest sanction in the bottom row and, on the server's, the service court on
 * the serving plate; the game of how many and the interval in the strip; and Sanction (per side) and Set score (only
 * before a game's first rally) in the tool row. A decided match is the recorded result's card over the final score.
 * Before the match starts, the Start screen's question in the halves' place, and no tools. `sync` is the transport's
 * word, not the match's.
 */
export function badmintonPad(
  state: BadmintonDisplay,
  sync: PadSync = SYNCED,
): PadView<BadmintonPadKey> {
  const view: PadView<BadmintonPadKey> = {
    halves: [half(state, 'first'), half(state, 'second')],
    tally: tally(state),
    details: badmintonDetails(state),
    start: startOf(state),
    strip: strip(state),
    lastTap: lastTap(state),
    sync,
    tools: tools(state),
    card: null,
  };
  return withCard(
    view,
    state.phase === 'decided' ? { kind: 'resultRecorded', undoLeft: null } : null,
  );
}

/** The tool ids `badmintonPad` gives, read back; anything else is null. */
export function parseBadmintonTool(
  id: string,
): { readonly kind: 'sanction'; readonly side: PadSide } | { readonly kind: 'setScore' } | null {
  if (id === 'sanction.first') return { kind: 'sanction', side: 'first' };
  if (id === 'sanction.second') return { kind: 'sanction', side: 'second' };
  return id === 'setScore' ? { kind: 'setScore' } : null;
}

const started = (state: BadmintonDisplay) => state.phase !== 'notStarted';
const open = (state: BadmintonDisplay) =>
  started(state) && state.phase !== 'decided' && !state.awaitingEnding;

function half(state: BadmintonDisplay, side: PadSide): PadHalf<BadmintonPadKey> {
  const plate =
    started(state) && state.phase !== 'decided' && state.server === side
      ? serving(state.court)
      : null;
  return {
    side,
    label: sideNames(state.sides[side]),
    value: String(state.points[side]),
    periods: periods(state.finished, side),
    sub: heaviestSanction(state, side),
    serving: plate,
    // The bar follows the plate (owner, 2026-11-02): the serving side's is lit, so when the serve changes the light moves
    // with it, and neither is lit while the ledger names no server, before the match starts and once it is over.
    bar: plate === null ? 'dim' : 'lit',
    hint: { key: 'scoring.badminton.hint' },
    hintLine: { key: 'scoring.badminton.hintLine', vars: { side: sideNames(state.sides[side]) } },
    tappable: open(state),
  };
}

/**
 * The side's score in each game over, its wins marked and a disqualified game's DQ on the side disqualified; said
 * "Games: 21, 18", then a disqualified game apart ("Game 2: 9, disqualified"). None in game 1.
 */
function periods(
  finished: readonly BadmintonGame[],
  side: PadSide,
): PadPeriods<BadmintonPadKey> | null {
  if (finished.length === 0) return null;
  const played = finished.filter((game) => 'winner' in game);
  const said: Text[] =
    played.length === 0
      ? []
      : [
          {
            key: 'scoring.badminton.gamesSaid.other',
            count: played.length,
            vars: { scores: played.map((game) => game.points[side]).join(', ') },
          },
        ];
  finished.forEach((game, at) => {
    if ('disqualified' in game) said.push(stoppedSaid(game, at + 1, side));
  });
  return { scores: finished.map((game) => periodScore(game, side)), said };
}

const DQ: Text = { key: 'scoring.badminton.mark.disqualified' };

/** A game's box for the side: lime when it won the game on points, DQ when it was disqualified in it. */
function periodScore(game: BadmintonGame, side: PadSide): PadPeriodScore<BadmintonPadKey> {
  const value = String(game.points[side]);
  if ('winner' in game) return { value, won: game.winner === side };
  return game.disqualified === side ? { value, won: false, mark: DQ } : { value, won: false };
}

/** A disqualified game, said apart: "Game 2: 9, disqualified" for the side disqualified, "Game 2: 4" for the other. */
function stoppedSaid(
  game: Extract<BadmintonGame, { readonly disqualified: PadSide }>,
  number: number,
  side: PadSide,
): Text {
  const key =
    game.disqualified === side
      ? 'scoring.badminton.gameSaid.disqualified'
      : 'scoring.badminton.gameSaid.stopped';
  return { key, vars: { game: number, points: game.points[side] } };
}

/**
 * Before the match starts (owner, 2026-11-01, option A): who serves first, from the two sides as typed, top first. Once
 * it has started, none.
 */
function startOf(state: BadmintonDisplay): PadStart<BadmintonPadKey> | null {
  if (started(state)) return null;
  return {
    ask: { key: 'scoring.badminton.start.ask' },
    sides: [
      { side: 'first', label: sideNames(state.sides.first) },
      { side: 'second', label: sideNames(state.sides.second) },
    ],
  };
}

/**
 * The match's context and its rules, for MatchCard: the Start screen, the Not started card and the Match details sheet
 * (owner, 2026-11-01).
 */
export function badmintonDetails(state: BadmintonDisplay): PadMatchDetails<BadmintonPadKey> {
  return { context: state.context, rules: badmintonRuleRows(state.rules) };
}

/**
 * The games each side has won, top first ("1:0"; owner, 2026-11-01), from the start ("0:0"). A game a disqualification
 * ended (owner ruling 18) counts for nobody: no side won it on points.
 */
function tally(state: BadmintonDisplay): PadTally<BadmintonPadKey> {
  const won = (side: PadSide) =>
    state.finished.filter((game) => 'winner' in game && game.winner === side).length;
  return {
    shown: `${won('first')}:${won('second')}`,
    said: {
      key: 'scoring.badminton.gamesTally',
      vars: {
        first: sideNames(state.sides.first),
        firstGames: won('first'),
        second: sideNames(state.sides.second),
        secondGames: won('second'),
      },
    },
  };
}

/** The side's heaviest sanction's word, or none. */
function heaviestSanction(state: BadmintonDisplay, side: PadSide): Text | null {
  const heaviest = state.sanctions
    .filter((sanction) => sanction.side === side)
    .map((sanction) => SANCTION_LEVELS.indexOf(sanction.level))
    .reduce((top, at) => Math.max(top, at), -1);
  const level = SANCTION_LEVELS[heaviest];
  return level === undefined ? null : sanctionWord(level);
}

/** The plate's "Serving · right", said "Serving, right service court" (owner ruling 17). */
function serving(court: BadmintonCourt): PadServing<BadmintonPadKey> {
  return {
    shown: { key: `scoring.badminton.serving.${court}` },
    said: { key: `scoring.badminton.servingSaid.${court}` },
  };
}

/** "Game 2 of 3" (owner ruling 16; "of 3" is the best of 3) and the interval; the game's the last once decided. */
function strip(state: BadmintonDisplay): readonly PadStripItem<BadmintonPadKey>[] {
  const decided = state.phase === 'decided';
  return [
    {
      slot: 'game',
      text: {
        key: 'scoring.badminton.gameOf',
        vars: { game: state.game, bestOf: state.rules.bestOf },
      },
    },
    { slot: 'interval', text: decided ? null : interval(state) },
  ];
}

/**
 * Before either side reaches the interval point, where it is; at the rally that took a side there first, the interval
 * itself; after it, or with both sides on it, nothing. The web's rule (skins/badminton.tsx `intervalHint`): the rally's
 * winner serves, so a side on the mark that is not serving reached it long ago; with nobody named serving, a side on
 * the mark alone still says Interval, because an umpire missing a 60-second interval is worse than seeing it a rally
 * late.
 */
function interval(state: BadmintonDisplay): Text | null {
  const at = state.rules.intervalPoint;
  const { first, second } = state.points;
  const leader = Math.max(first, second);
  if (leader < at) return { key: 'scoring.badminton.intervalAt', vars: { point: at } };
  if (leader > at || first === second) return null;
  const onMark: PadSide = first === at ? 'first' : 'second';
  if (state.server !== null && state.server !== onMark) return null;
  return { key: 'scoring.badminton.intervalNow' };
}

function tools(state: BadmintonDisplay): readonly PadTool<BadmintonPadKey>[] {
  if (!started(state)) return [];
  const enabled = !state.awaitingEnding;
  const sanction = (side: PadSide): PadTool<BadmintonPadKey> => ({
    id: `sanction.${side}`,
    label: { key: 'scoring.badminton.tool.sanction' },
    detail: sideNames(state.sides[side]),
    kind: 'destructive',
    enabled,
  });
  const beforeFirstRally = state.phase === 'pre' || state.phase === 'betweenGames';
  const setScore: PadTool<BadmintonPadKey> = {
    id: 'setScore',
    label: { key: 'scoring.badminton.tool.setScore' },
    detail: null,
    kind: 'standard',
    enabled,
  };
  return beforeFirstRally
    ? [sanction('first'), sanction('second'), setScore]
    : [sanction('first'), sanction('second')];
}

/** The last tap's line; none before the start, when there is no match on the pad to speak of (review M6). */
function lastTap(state: BadmintonDisplay): PadLastTap<BadmintonPadKey> | null {
  if (!started(state) || state.lastTap === null) return null;
  return {
    text: lastTapText(state, state.lastTap),
    undo: state.undoable && !state.awaitingEnding,
  };
}

function lastTapText(state: BadmintonDisplay, tap: BadmintonLastTap): Text {
  return tap.kind === 'undone' ? undoneText(state, tap.tap) : doneSaid(state.sides, tap);
}

/**
 * What a tap did, in the last-tap line's words ("Rally recorded — A. Sharma"): the line says it of the last tap, and
 * History (owner ruling 21) of every tap, in the one vocabulary.
 */
export function doneSaid(sides: BadmintonDisplay['sides'], tap: BadmintonDone): Text {
  const side = (of: PadSide) => sideNames(sides[of]);
  switch (tap.kind) {
    case 'start':
      return tap.server === null
        ? { key: 'scoring.badminton.last.startUnknownServer' }
        : { key: 'scoring.badminton.last.start', vars: { side: side(tap.server) } };
    case 'rally':
      if (tap.won === 'game') {
        return {
          key: 'scoring.badminton.last.game',
          vars: { game: tap.game, side: side(tap.side) },
        };
      }
      return {
        key: tap.won === 'match' ? 'scoring.badminton.last.match' : 'scoring.badminton.last.rally',
        vars: { side: side(tap.side) },
      };
    case 'sanction':
      return {
        key: 'scoring.badminton.last.sanction',
        vars: { level: sanctionWord(tap.level), person: tap.person },
      };
    case 'setScore':
      return { key: 'scoring.badminton.last.setScore', vars: { score: scoreText(tap) } };
    case 'ending':
      return { key: 'scoring.badminton.last.ending', vars: { person: tap.person } };
  }
}

function undoneText(state: BadmintonDisplay, tap: BadmintonUndoneTap): Text {
  switch (tap.kind) {
    case 'rally':
      return {
        key: 'scoring.badminton.undone.rally',
        vars: { side: sideNames(state.sides[tap.side]) },
      };
    case 'sanction':
      return {
        key: 'scoring.badminton.undone.sanction',
        vars: { level: sanctionWord(tap.level), person: tap.person },
      };
    case 'setScore':
      return { key: 'scoring.badminton.undone.setScore' };
    case 'ending':
      return { key: 'scoring.badminton.undone.ending', vars: { person: tap.person } };
  }
}
