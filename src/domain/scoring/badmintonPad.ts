import type { BadmintonRuleKey, BadmintonRules } from '@/domain/scoring/badmintonRules';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadSide,
  type PadStripItem,
  type PadSync,
  type PadText,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';

/** The web's four sanction levels (`sanction.*`), lightest first. */
export type BadmintonSanctionLevel = 'warning' | 'penalty' | 'expulsion' | 'disqualification';
export const SANCTION_LEVELS: readonly BadmintonSanctionLevel[] = [
  'warning',
  'penalty',
  'expulsion',
  'disqualification',
];

/** A side's players as the organiser typed them: one in singles, two in doubles. */
export type BadmintonSide = { readonly players: readonly string[] };

export type BadmintonSanction = {
  readonly side: PadSide;
  readonly level: BadmintonSanctionLevel;
  readonly person: string;
};

/** One tap the scorer can make on the pad. `ending` is a disqualification's: the match ends, the other side wins. */
export type BadmintonTap =
  | { readonly kind: 'rally'; readonly side: PadSide }
  | ({ readonly kind: 'sanction' } & BadmintonSanction)
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'ending'; readonly side: PadSide; readonly person: string };

/** What the last tap did: a rally says whether it won a game or the match; `undone` names the tap Undo took back. */
export type BadmintonLastTap =
  | {
      readonly kind: 'rally';
      readonly side: PadSide;
      readonly won: 'none' | 'game' | 'match';
      readonly game: number;
    }
  | ({ readonly kind: 'sanction' } & BadmintonSanction)
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'ending'; readonly side: PadSide; readonly person: string }
  | { readonly kind: 'undone'; readonly tap: BadmintonTap };

/** Before the match's first rally; a game under way; a game won and the next not yet started; the match over. */
export type BadmintonPhase = 'pre' | 'live' | 'betweenGames' | 'decided';

/**
 * A badminton match as the pad shows it. Whoever keeps the score (the engine in S2; the preview's fake today) decides
 * every field: this file only draws them.
 */
export type BadmintonDisplay = {
  readonly sides: Readonly<Record<PadSide, BadmintonSide>>;
  readonly points: Readonly<Record<PadSide, number>>;
  readonly games: Readonly<Record<PadSide, number>>;
  readonly server: PadSide;
  readonly court: 'left' | 'right';
  /** The game under way, or about to start; the last one once decided. */
  readonly game: number;
  /** The match's config: the strip's format and interval, and the Rules sheet (`badmintonRuleLines`). */
  readonly rules: BadmintonRules;
  readonly phase: BadmintonPhase;
  readonly sanctions: readonly BadmintonSanction[];
  readonly lastTap: BadmintonLastTap | null;
  /** This phone has a tap of its own that Undo can take back (owner, 2026-10-31: one Undo, own taps only). */
  readonly undoable: boolean;
  /** A disqualification is recorded and its ending not yet chosen: record it, or void the sanction. */
  readonly awaitingEnding: boolean;
};

/** Every dictionary key this file names. The kit translates them as `MessageKey`, so each must exist in en.json. */
export type BadmintonPadKey =
  | 'scoring.badminton.games'
  | 'scoring.badminton.gamesSanctioned'
  | 'scoring.badminton.hint'
  | 'scoring.badminton.hintLine'
  | 'scoring.badminton.context'
  | 'scoring.badminton.court.left'
  | 'scoring.badminton.court.right'
  | 'scoring.badminton.intervalAt'
  | 'scoring.badminton.intervalNow'
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

type Text = PadText<BadmintonPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** A sanction level's word (the web's `sanction.*`). */
export function sanctionWord(level: BadmintonSanctionLevel): PadText<SanctionLevelKey> {
  return { key: `scoring.sanction.${level}` };
}

/** A side's names as one line: partners joined, as the match label joins them. */
export function sideNames(side: BadmintonSide): string {
  return side.players.join(' / ');
}

/**
 * Layout A's pad for a badminton match (owner rulings, 2026-10-31): the first side on top, the second below, the
 * format, game, service court and interval in the strip, and Sanction (per side) and Set score (only before a game's
 * first rally) in the tool row. A decided match is the recorded result's card over the final score. `sync` is the
 * transport's word, not the match's.
 */
export function badmintonPad(
  state: BadmintonDisplay,
  sync: PadSync = SYNCED,
): PadView<BadmintonPadKey> {
  const view: PadView<BadmintonPadKey> = {
    halves: [half(state, 'first'), half(state, 'second')],
    strip: strip(state),
    lastTap: lastTap(state),
    sync,
    tools: tools(state),
    card: null,
  };
  return withCard(view, state.phase === 'decided' ? { kind: 'resultRecorded' } : null);
}

/** The tool ids `badmintonPad` gives, read back; anything else is null. */
export function parseBadmintonTool(
  id: string,
): { readonly kind: 'sanction'; readonly side: PadSide } | { readonly kind: 'setScore' } | null {
  if (id === 'sanction.first') return { kind: 'sanction', side: 'first' };
  if (id === 'sanction.second') return { kind: 'sanction', side: 'second' };
  return id === 'setScore' ? { kind: 'setScore' } : null;
}

const open = (state: BadmintonDisplay) => state.phase !== 'decided' && !state.awaitingEnding;

function half(state: BadmintonDisplay, side: PadSide): PadHalf<BadmintonPadKey> {
  return {
    side,
    label: sideNames(state.sides[side]),
    value: String(state.points[side]),
    sub: gamesLine(state, side),
    serving: state.phase !== 'decided' && state.server === side,
    hint: { key: 'scoring.badminton.hint' },
    hintLine: { key: 'scoring.badminton.hintLine', vars: { side: sideNames(state.sides[side]) } },
    tappable: open(state),
  };
}

/** "Games 1", or "Games 1 · Penalty" with the side's heaviest sanction. */
function gamesLine(state: BadmintonDisplay, side: PadSide): Text {
  const count = state.games[side];
  const heaviest = state.sanctions
    .filter((sanction) => sanction.side === side)
    .map((sanction) => SANCTION_LEVELS.indexOf(sanction.level))
    .reduce((top, at) => Math.max(top, at), -1);
  const level = SANCTION_LEVELS[heaviest];
  return level === undefined
    ? { key: 'scoring.badminton.games', vars: { count } }
    : { key: 'scoring.badminton.gamesSanctioned', vars: { count, sanction: sanctionWord(level) } };
}

function strip(state: BadmintonDisplay): readonly PadStripItem<BadmintonPadKey>[] {
  const decided = state.phase === 'decided';
  return [
    {
      slot: 'context',
      text: {
        key: 'scoring.badminton.context',
        vars: { bestOf: state.rules.bestOf, game: state.game },
      },
    },
    {
      slot: 'court',
      text: decided ? null : { key: `scoring.badminton.court.${state.court}` },
    },
    { slot: 'interval', text: decided ? null : interval(state) },
  ];
}

/**
 * Before either side reaches the interval point, where it is; at the rally that took the server there first, the
 * interval itself (the rally's winner serves, so the side that just reached it is the server); after it, nothing.
 */
function interval(state: BadmintonDisplay): Text | null {
  const at = state.rules.intervalPoint;
  const server = state.points[state.server];
  const receiver = state.points[state.server === 'first' ? 'second' : 'first'];
  if (Math.max(server, receiver) < at) {
    return { key: 'scoring.badminton.intervalAt', vars: { point: at } };
  }
  return server === at && receiver < at ? { key: 'scoring.badminton.intervalNow' } : null;
}

function tools(state: BadmintonDisplay): readonly PadTool<BadmintonPadKey>[] {
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

function lastTap(state: BadmintonDisplay): PadLastTap<BadmintonPadKey> | null {
  if (state.lastTap === null) return null;
  return {
    text: lastTapText(state, state.lastTap),
    undo: state.undoable && !state.awaitingEnding,
  };
}

function lastTapText(state: BadmintonDisplay, tap: BadmintonLastTap): Text {
  const side = (of: PadSide) => sideNames(state.sides[of]);
  switch (tap.kind) {
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
      return { key: 'scoring.badminton.last.setScore', vars: { score: score(tap) } };
    case 'ending':
      return { key: 'scoring.badminton.last.ending', vars: { person: tap.person } };
    case 'undone':
      return undoneText(state, tap.tap);
  }
}

function undoneText(state: BadmintonDisplay, tap: BadmintonTap): Text {
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

/** Top first, an en dash between: numbers are not translated (docs/i18n-glossary.md, Typography). */
const score = ({ first, second }: { first: number; second: number }) => `${first}–${second}`;
