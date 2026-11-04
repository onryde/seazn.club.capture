import { tabletennisPadRules } from '@seazn/engine/pad';
import type { MatchContext } from '@/domain/scoring/matchContext';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadMatchDetails,
  type PadPeriods,
  type PadServing,
  type PadSide,
  type PadStripItem,
  type PadSync,
  type PadText,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';
import type { SetBasedGame, SetBasedPhase } from '@/domain/scoring/setBasedBoard';
import {
  gamesWon,
  playedSaid,
  playedScore,
  resultCardOf,
  setBasedGameItem,
  setBasedHalfWords,
  setBasedStart,
  setBasedTally,
} from '@/domain/scoring/setBasedPad';
import { sideNames, type SetBasedSide } from '@/domain/scoring/setBasedSides';
import { cardWord, doneSaid } from '@/domain/scoring/tableTennisHistory';
import { tableTennisRuleRows, type TableTennisRuleKey } from '@/domain/scoring/tableTennisRules';

/**
 * Table tennis on the pad: the types (plan S2-2 Task 3) and the view that draws them (Task 5). Whoever keeps the score
 * (the engine, through `foldTableTennis`) decides every field of the display: the pad only draws them. Table tennis has
 * its own types beside badminton's (owner, 2026-11-02: pad per sport), though several are alike; what is word for word
 * the same is the set-based sports' to share (`setBasedPad`).
 */

/** The ITTF umpire's two cards (`tabletennisPadRules.sanctionLevels`): yellow is `warning`, red is `penalty`. */
export type TableTennisSanctionLevel = 'warning' | 'penalty';

/** A side's players as the organiser typed them: one in singles, two in doubles. */
export type TableTennisSide = SetBasedSide;

/**
 * One tap the scorer can make on the pad. `start` starts the match, the side picked serving first (design §4.1);
 * `rally.serving` is the held Who is serving? answer, else null (design §4.2); `returns` is the point the receiver wins
 * on their thirteenth good return, under Expedite (design §4.5).
 */
export type TableTennisTap =
  | { readonly kind: 'start'; readonly server: PadSide }
  | { readonly kind: 'rally'; readonly side: PadSide; readonly serving: PadSide | null }
  | { readonly kind: 'returns'; readonly side: PadSide }
  | { readonly kind: 'timeout'; readonly side: PadSide }
  | { readonly kind: 'expedite' }
  | {
      readonly kind: 'sanction';
      readonly side: PadSide;
      readonly level: TableTennisSanctionLevel;
      readonly person: string | null;
    }
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number };

/** Whether a point won a game or the match. */
export type TableTennisWon = 'none' | 'game' | 'match';

/**
 * What the last tap did: a point says whether it won a game or the match; `undone` names the tap Undo took back. The
 * start names its first server when the ledger or this phone's pick says it, else null (a match started elsewhere). A
 * card names its player, or the side's names when no player was.
 */
export type TableTennisLastTap =
  | { readonly kind: 'start'; readonly server: PadSide | null }
  | {
      readonly kind: 'rally';
      readonly side: PadSide;
      readonly won: TableTennisWon;
      readonly game: number;
    }
  | {
      readonly kind: 'returns';
      readonly side: PadSide;
      readonly won: TableTennisWon;
      readonly game: number;
      /** The receiver's returns the point was recorded with. */
      readonly returns: number;
    }
  | { readonly kind: 'timeout'; readonly side: PadSide }
  | { readonly kind: 'expedite' }
  | {
      readonly kind: 'sanction';
      readonly side: PadSide;
      readonly level: TableTennisSanctionLevel;
      readonly person: string;
    }
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'undone'; readonly tap: TableTennisUndoneTap };

/** What a tap did when it was recorded: the last-tap line's tap, never an Undo (History lists Undo on the tap it took). */
export type TableTennisDone = Exclude<TableTennisLastTap, { readonly kind: 'undone' }>;

/** A tap Undo took back, as the last-tap line names it: never the start, whose Undo returns to the Start screen. */
export type TableTennisUndoneTap = Exclude<TableTennisDone, { readonly kind: 'start' }>;

/** A game over: each side's points when it ended, and the side that won it. */
export type TableTennisGame = SetBasedGame;

/**
 * Not started (the Start screen: who serves first is not yet picked); started, before the match's first point; a game
 * under way; a game won and the next not yet started; the match over. Badminton's values, in a type of its own.
 */
export type TableTennisPhase = SetBasedPhase;

/** The match's rules, read through the engine from its config (`tabletennisPadRules`): never a number of ours. */
export type TableTennisRules = {
  readonly bestOf: number;
  /** A game's target, and the deciding game's own (they differ only if the organiser made them). */
  readonly setTo: number;
  readonly finalSetTo: number;
  readonly winBy: number;
  /** The most a game's score may be set to (Set score's steppers). */
  readonly scoreBound: number;
};

/**
 * Whether the umpire can start Expedite now (`offered`), has (`inForce`: for the rest of the match, ITTF 2.15.4), or it
 * cannot be started (`off`: not live, the match does not record it, or both sides have 9 in the game under way).
 */
export type TableTennisExpedite = 'off' | 'offered' | 'inForce';

/** Which things the match records: its config's `records`, so a pad offers no tool the engine would refuse. */
export type TableTennisRecords = {
  readonly timeouts: boolean;
  readonly sanctions: boolean;
  readonly expedite: boolean;
};

/**
 * A table tennis match as the pad shows it. The serve comes from the engine's reader (`setBasedServeContext`), never
 * from our own arithmetic; before the match's first point the Start pick shows in its place.
 */
export type TableTennisDisplay = {
  readonly sides: Readonly<Record<PadSide, TableTennisSide>>;
  /** Where the match sits: competition, division, round, the fixture's code, the sides. */
  readonly context: MatchContext;
  /** The game under way, or about to start; the last one's final score once the match is decided. */
  readonly points: Readonly<Record<PadSide, number>>;
  /** Every game over, in order, the match's last one included. */
  readonly finished: readonly TableTennisGame[];
  /** The game under way, or about to start; the last one once decided. */
  readonly game: number;
  readonly rules: TableTennisRules;
  readonly phase: TableTennisPhase;
  /**
   * The side due to serve, or null when the ledger does not say: the Start pick was lost (a co-scorer's point landed
   * first), the first game was set whole, or the engine found the ledger contradicts itself. Null draws no plate.
   * It may be this phone's Start pick, which no ledger event has named: then `serverPicked` is true. A pick is not the
   * engine's belief, so a rule that needs the server known (a 13 returns point, design §4.5) reads the engine, never this.
   */
  readonly server: PadSide | null;
  /**
   * The serving player's name, in doubles, when the engine names one: from the team sheet's pair order, and only for a
   * side that lists exactly its pair (a bench row could make the phone and the web disagree). Else null: the plate names
   * the side.
   */
  readonly serverPerson: string | null;
  /** The same player's id, for the rally's `server` (a name is not a key). Null exactly when `serverPerson` is. */
  readonly serverPersonId: string | null;
  /** The serve of the pair the engine is at, 1 or 2; at deuce and under Expedite it says 1. Null when it names none. */
  readonly serveNumber: 1 | 2 | null;
  /** The server shown is this phone's pick on the Start screen, the ledger having named nobody yet. */
  readonly serverPicked: boolean;
  /**
   * Nobody can say who serves for want of an anchor and this phone's pick is not standing in (`serverPicked`): the pad
   * offers Who is serving? (design §4.2, fix round 1: asked at 0-0 too, for a match started elsewhere).
   */
  readonly anchorNeeded: boolean;
  readonly expedite: TableTennisExpedite;
  /**
   * The score events standing in the scorer's view: the ledger's points and game scores no void takes back, and this
   * phone's legal queued taps on top. A `serving` stamp is valid only at the score it was made at, so a tap that names one
   * is queued with this count as its `base` and its first send drops the stamp if the ledger's count is another
   * (`tableTennisEventFor`, `tableTennisPayloadForSend`). Timeouts, cards and Expedite are not score events.
   */
  readonly scoreEvents: number;
  /** Level in the endgame, where a side needs two clear: from the target less one (10–10; hardbat 20–20). */
  readonly deuce: boolean;
  readonly records: TableTennisRecords;
  readonly lastTap: TableTennisLastTap | null;
  /** This phone has a tap of its own that Undo can take back (owner, 2026-10-31: one Undo, own taps only). */
  readonly undoable: boolean;
};

/** How the plate says the serve: the engine's number of the pair's serves, or none. */
export type ServingForm = 'first' | 'second' | 'plain';

/**
 * Every dictionary key the pad and its History words name. The kit translates them as `MessageKey`, so each must exist
 * in en.json.
 */
export type TableTennisPadKey =
  | 'scoring.tabletennis.gameHeading'
  | 'scoring.tabletennis.last.start'
  | 'scoring.tabletennis.last.startUnknownServer'
  | 'scoring.tabletennis.last.rally'
  | 'scoring.tabletennis.last.game'
  | 'scoring.tabletennis.last.match'
  | 'scoring.tabletennis.last.returns'
  | 'scoring.tabletennis.last.timeout'
  | 'scoring.tabletennis.last.expedite'
  | 'scoring.tabletennis.last.sanction'
  | 'scoring.tabletennis.last.setScore'
  | `scoring.tabletennis.undone.${TableTennisUndoneTap['kind']}`
  | `scoring.tabletennis.card.${TableTennisSanctionLevel}`
  | 'scoring.tabletennis.gamesSaid.other'
  | 'scoring.tabletennis.gamesTally'
  | 'scoring.tabletennis.gameOf'
  | 'scoring.tabletennis.hint'
  | 'scoring.tabletennis.hintLine'
  | 'scoring.tabletennis.start.ask'
  | `scoring.tabletennis.serving.${ServingForm}`
  | `scoring.tabletennis.servingSaid.${ServingForm}`
  | 'scoring.tabletennis.serverPerson'
  | 'scoring.tabletennis.note.expedite'
  | 'scoring.tabletennis.note.deuce'
  | 'scoring.tabletennis.tool.card'
  | 'scoring.tabletennis.tool.returns'
  | 'scoring.tabletennis.tool.serving'
  | 'scoring.tabletennis.tool.more'
  | 'scoring.tabletennis.sheet.card'
  | 'scoring.tabletennis.sheet.serving'
  | 'scoring.tabletennis.more.timeout'
  | 'scoring.tabletennis.more.expedite'
  | 'scoring.tabletennis.more.setScore'
  | 'scoring.tabletennis.held'
  | TableTennisRuleKey;

/** Table tennis's pad types: what the match runtime is generic over (`SportTypes`). */
export type TableTennisTypes = {
  readonly tap: TableTennisTap;
  readonly display: TableTennisDisplay;
  readonly padKey: TableTennisPadKey;
  readonly undone: TableTennisUndoneTap;
};

// ---------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------

type Text = PadText<TableTennisPadKey>;
type Tool = PadTool<TableTennisPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** The words a set-based pad names alike, in table tennis's own namespace (`setBasedPad`). */
const WORDS = {
  gamesSaid: 'scoring.tabletennis.gamesSaid.other',
  gamesTally: 'scoring.tabletennis.gamesTally',
  gameOf: 'scoring.tabletennis.gameOf',
  hint: 'scoring.tabletennis.hint',
  hintLine: 'scoring.tabletennis.hintLine',
  startAsk: 'scoring.tabletennis.start.ask',
} as const;

const OTHER_SIDE = { first: 'second', second: 'first' } as const;

const started = (display: TableTennisDisplay) => display.phase !== 'notStarted';
/** The pad takes a point: the match has started and is not decided. */
const takesPoints = (display: TableTennisDisplay) =>
  started(display) && display.phase !== 'decided';

/**
 * The pad for a table tennis match (design §5; the owner's rulings 48 to 52, 2026-11-03): the first side on top, the
 * second below, each with its finished games' scores and, on the server's, the serving plate with the engine's serve
 * number and in doubles the player; the game of how many and one note (Expedite, else Deuce) in the strip; and a Card
 * for each side, 13 returns or Who is serving?, and More in the tool row. A decided match is the recorded result's card
 * over the final score. Before the match starts, the Start screen's question in the halves' place, and no tools. `sync`
 * is the transport's word, not the match's.
 */
export function tableTennisPad(
  display: TableTennisDisplay,
  sync: PadSync = SYNCED,
): PadView<TableTennisPadKey> {
  const view: PadView<TableTennisPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: setBasedTally(WORDS.gamesTally, display.sides, gamesWon(display.finished)),
    details: tableTennisDetails(display),
    start: setBasedStart(WORDS.startAsk, display.sides, display.phase),
    strip: strip(display),
    lastTap: lastTap(display),
    sync,
    tools: tools(display),
    card: null,
  };
  return withCard(view, resultCardOf(display.phase));
}

/** The match's context and its rules, for MatchCard: the Start screen, the Not started card and the Match details sheet. */
export function tableTennisDetails(
  display: TableTennisDisplay,
): PadMatchDetails<TableTennisPadKey> {
  return {
    context: display.context,
    rules: tableTennisRuleRows(display.rules, display.records),
  };
}

function half(display: TableTennisDisplay, side: PadSide): PadHalf<TableTennisPadKey> {
  const plate =
    takesPoints(display) && display.server === side ? serving(display.serveNumber) : null;
  const names = sideNames(display.sides[side]);
  return {
    side,
    label: names,
    value: String(display.points[side]),
    periods: periods(display.finished, side),
    sub: plate === null ? null : serverPerson(display),
    serving: plate,
    // The bar follows the plate (owner, 2026-11-02): the serving side's is lit, and neither is while the engine names no
    // server, before the match starts and once it is over.
    bar: plate === null ? 'dim' : 'lit',
    ...setBasedHalfWords<TableTennisPadKey>(WORDS, names),
    tappable: takesPoints(display),
  };
}

/** The side's score in each game over, its wins marked, said "Games: 11, 9". None in game 1. */
function periods(
  finished: readonly TableTennisGame[],
  side: PadSide,
): PadPeriods<TableTennisPadKey> | null {
  if (finished.length === 0) return null;
  return {
    scores: finished.map((game) => playedScore(game, side)),
    said: [playedSaid<TableTennisPadKey>(WORDS.gamesSaid, finished, side)],
  };
}

const SERVE_FORM = { 1: 'first', 2: 'second' } as const;

/** The plate's "Serving · 2nd", said "Serving, second serve"; "Serving" alone when the engine names no number. */
function serving(number: 1 | 2 | null): PadServing<TableTennisPadKey> {
  const form: ServingForm = number === null ? 'plain' : SERVE_FORM[number];
  return {
    shown: { key: `scoring.tabletennis.serving.${form}` },
    said: { key: `scoring.tabletennis.servingSaid.${form}` },
  };
}

/** The doubles server the engine names (ruling 5), by name and id both; else nobody: the plate names the side. */
function serverPerson(display: TableTennisDisplay): Text | null {
  if (display.serverPersonId === null || display.serverPerson === null) return null;
  return { key: 'scoring.tabletennis.serverPerson', vars: { person: display.serverPerson } };
}

/** "Game 2 of 5" and one note at the right (design §5.2): Expedite, in force match-wide, else Deuce, else nothing. */
function strip(display: TableTennisDisplay): readonly PadStripItem<TableTennisPadKey>[] {
  return [
    setBasedGameItem(WORDS.gameOf, display.game, display.rules.bestOf),
    { slot: 'note', text: noteOf(display) },
  ];
}

/** Nothing once the match is decided: a decided board has no next point to describe, as the web's. */
function noteOf(display: TableTennisDisplay): Text | null {
  if (display.phase === 'decided') return null;
  if (display.expedite === 'inForce') return { key: 'scoring.tabletennis.note.expedite' };
  return display.deuce ? { key: 'scoring.tabletennis.note.deuce' } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The tools (ruling 52, design §5.3)
// ---------------------------------------------------------------------------------------------------------------

/** The cells with no second line: a plain outline, usable. */
const PLAIN = { detail: null, kind: 'standard', enabled: true } as const;

/** The 13 returns cell's id: `returns.` and the side it credits, the receiver it was drawn for. */
const RETURNS = 'returns.';
const SERVING = 'serving';
const MORE = 'more';

/**
 * The Who is serving? sheet's title: ruling 51's words in full, where its cell says them shortened to fit four to a row
 * (Task 8 fix round 1; the controller's sheet-title ruling). The sheet itself is the hook's (`useTableTennisSheets`).
 */
export const tableTennisServingTitle: Text = { key: 'scoring.tabletennis.sheet.serving' };

function tools(display: TableTennisDisplay): readonly Tool[] {
  if (!started(display)) return [];
  return [...cards(display), ...serveTool(display), ...moreTool(display)];
}

/** A Card for each side, while the match records cards: the umpire's yellow and red, chosen in the sheet. */
function cards(display: TableTennisDisplay): readonly Tool[] {
  if (!display.records.sanctions) return [];
  const card = (side: PadSide): Tool => ({
    id: `card.${side}`,
    label: { key: 'scoring.tabletennis.tool.card' },
    // The cell is shortened to fit four to a row (es "Tarj."); a screen reader hears the sheet's full word.
    said: { key: 'scoring.tabletennis.sheet.card' },
    detail: sideNames(display.sides[side]),
    kind: 'destructive',
    enabled: true,
  });
  return [card('first'), card('second')];
}

/** Who is serving? when the pad needs the answer, else 13 returns when it is offered, never both (rulings 50 and 51). */
function serveTool(display: TableTennisDisplay): readonly Tool[] {
  if (display.anchorNeeded) {
    return [{ id: SERVING, label: { key: 'scoring.tabletennis.tool.serving' }, ...PLAIN }];
  }
  const returns = returnsTool(display);
  return returns === null ? [] : [returns];
}

/**
 * 13 returns · {receiver} (ruling 50): only while Expedite is in force and the engine names the server (the Start pick
 * is not the engine's belief: the fold's check reads the engine), and it gives the point to the side receiving. Its id
 * names that side (`returns.first`), so a press is the receiver the scorer saw however late it lands: a press on a cell
 * drawn before the serve changed is refused by the fold (the side now serving cannot be credited, `eventFor`), never
 * turned into the other side's point.
 */
function returnsTool(display: TableTennisDisplay): Tool | null {
  const { server } = display;
  if (display.expedite !== 'inForce' || server === null || display.serverPicked) return null;
  const receiver = OTHER_SIDE[server];
  return {
    id: `${RETURNS}${receiver}`,
    label: {
      key: 'scoring.tabletennis.tool.returns',
      vars: { returns: tabletennisPadRules.expediteReturns },
    },
    detail: sideNames(display.sides[receiver]),
    kind: 'standard',
    enabled: true,
  };
}

function moreTool(display: TableTennisDisplay): readonly Tool[] {
  if (tableTennisMoreItems(display).length === 0) return [];
  return [{ id: MORE, label: { key: 'scoring.tabletennis.tool.more' }, ...PLAIN }];
}

/** The tool ids `tableTennisPad` gives, read back; anything else is null. */
export function parseTableTennisTool(
  id: string,
):
  | { readonly card: PadSide }
  | { readonly returns: PadSide }
  | { readonly serving: true }
  | { readonly more: true }
  | null {
  if (id === 'card.first') return { card: 'first' };
  if (id === 'card.second') return { card: 'second' };
  if (id === `${RETURNS}first`) return { returns: 'first' };
  if (id === `${RETURNS}second`) return { returns: 'second' };
  if (id === SERVING) return { serving: true };
  return id === MORE ? { more: true } : null;
}

/** What the More sheet can list: a timeout for each side, Expedite, and Set score. */
export type TableTennisMoreItem = 'timeout.first' | 'timeout.second' | 'expedite' | 'setScore';

/**
 * The More sheet's items, each listed only when design §4 offers it: a timeout for each side while the match records
 * them (the engine accepts any number; ITTF's one is the umpire's to keep), Expedite while it is offered, and Set score
 * before a game's first point. Nothing on the Start screen or once the match is decided.
 */
export function tableTennisMoreItems(display: TableTennisDisplay): readonly TableTennisMoreItem[] {
  if (!takesPoints(display)) return [];
  const items: TableTennisMoreItem[] = [];
  if (display.records.timeouts) items.push('timeout.first', 'timeout.second');
  if (display.expedite === 'offered') items.push('expedite');
  if (display.phase === 'pre' || display.phase === 'betweenGames') items.push('setScore');
  return items;
}

/** One choice in the More sheet: the item and its words. */
export type TableTennisMoreOption = { readonly id: TableTennisMoreItem; readonly label: Text };

/** The More sheet's choices in words, in the items' order. */
export function tableTennisMoreOptions(
  display: TableTennisDisplay,
): readonly TableTennisMoreOption[] {
  const timeout = (side: PadSide): Text => ({
    key: 'scoring.tabletennis.more.timeout',
    vars: { side: sideNames(display.sides[side]) },
  });
  const label = (item: TableTennisMoreItem): Text => {
    switch (item) {
      case 'timeout.first':
        return timeout('first');
      case 'timeout.second':
        return timeout('second');
      case 'expedite':
        return { key: 'scoring.tabletennis.more.expedite' };
      case 'setScore':
        return { key: 'scoring.tabletennis.more.setScore' };
    }
  };
  return tableTennisMoreItems(display).map((id) => ({ id, label: label(id) }));
}

// ---------------------------------------------------------------------------------------------------------------
// The last tap
// ---------------------------------------------------------------------------------------------------------------

/** The last tap's line; none before the start, when there is no match on the pad to speak of. */
function lastTap(display: TableTennisDisplay): PadLastTap<TableTennisPadKey> | null {
  if (!started(display) || display.lastTap === null) return null;
  const { lastTap: tap, sides } = display;
  return {
    text: tap.kind === 'undone' ? undoneSaid(sides, tap.tap) : doneSaid(sides, tap),
    undo: display.undoable,
  };
}

/** What Undo took back, in the last-tap line's words ("Point undone — A. Sharma"). */
function undoneSaid(sides: TableTennisDisplay['sides'], tap: TableTennisUndoneTap): Text {
  const side = (of: PadSide) => sideNames(sides[of]);
  switch (tap.kind) {
    case 'rally':
      return { key: 'scoring.tabletennis.undone.rally', vars: { side: side(tap.side) } };
    case 'returns':
      return {
        key: 'scoring.tabletennis.undone.returns',
        vars: { side: side(tap.side), returns: tap.returns },
      };
    case 'timeout':
      return { key: 'scoring.tabletennis.undone.timeout', vars: { side: side(tap.side) } };
    case 'expedite':
      return { key: 'scoring.tabletennis.undone.expedite' };
    case 'sanction':
      return {
        key: 'scoring.tabletennis.undone.sanction',
        vars: { level: cardWord(tap.level), person: tap.person },
      };
    case 'setScore':
      return { key: 'scoring.tabletennis.undone.setScore' };
  }
}

/**
 * The last-tap line while a Who is serving? answer is held (design §4.2): "Next point: {side} serving", until the next
 * point carries it. The rest of the view is as it was, and Undo stays for this phone's last real tap. Only while the pad
 * still needs the answer (`anchorNeeded`: once the engine names a server a stale answer is not shown as true) and under
 * no card (nothing takes a point there).
 */
export function withHeldServing(
  view: PadView<TableTennisPadKey>,
  held: PadSide | null,
  display: TableTennisDisplay,
): PadView<TableTennisPadKey> {
  if (held === null || !display.anchorNeeded || view.card !== null) return view;
  const text: Text = {
    key: 'scoring.tabletennis.held',
    vars: { side: sideNames(display.sides[held]) },
  };
  return { ...view, lastTap: { text, undo: view.lastTap?.undo ?? false } };
}
