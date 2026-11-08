import type {
  CricketBallEv,
  CricketCfg,
  CricketMargin,
  CricketScorecard,
  CricketState,
} from '@seazn/engine/sports/cricket';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide, PadText, PadVar } from '@/domain/scoring/padView';

/**
 * Cricket on the pad: the types (S2-4 spec §4 to §6, plan Task 5). The match is the engine's cricket module; its state is a
 * fold of the web's ledger by `@seazn/engine`, and these types are only what the pad needs of it. Every cricket rule is the
 * engine's: the display reads the fold off, and carries the effect of the scorer's pending picks (`cricketPicks.ts`), which
 * the server records only when a later ball carries them.
 */

// ---------------------------------------------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------------------------------------------

/** How a batter is out, in the engine's own words (`CricketWicket.kind`): what a ledger ball may say, the console's too. */
export type CricketWicketKind = NonNullable<CricketBallEv['wicket']>['kind'];

/**
 * How a batter is out on a ball the pad records (spec §4.3): never retired or timed out. Recorded on a ball, each adds a
 * legal ball none bowled; retirement is More's Retire (`cricket.retire`, no ball), and timed out is open (§11). The web's
 * console keeps both on a ball, so a ball on the ledger may still say either (`CricketWicketSeen`).
 */
export type CricketBallWicketKind = Exclude<CricketWicketKind, 'retired' | 'timedout'>;

/** An extra, in the engine's own words: its kind, and the runs it adds (a wide's own run included). */
export type CricketExtra = NonNullable<CricketBallEv['runs']['extras']>;

/** A dismissal on a ball: how, who, the fielder and a second one (a run out's), and who walks in. */
type WicketOf<K extends CricketWicketKind> = {
  readonly kind: K;
  readonly out: string;
  readonly fielder: string | null;
  readonly fielderAssist: string | null;
  readonly incoming: string | null;
};

/** A dismissal the pad records on a ball: never retired or timed out. */
export type CricketWicketTap = WicketOf<CricketBallWicketKind>;

/** A dismissal on a ball as the ledger holds it: any kind the engine takes, the console's retired and timed out too. */
export type CricketWicketSeen = WicketOf<CricketWicketKind>;

/**
 * One delivery as the scorer taps it: runs off the bat, one extra or none, a boundary (the 4 and 6 keys, ruling 73), a
 * dismissal or none. Who bats and bowls is the display's (its crease and its bowler), never the tap's.
 */
export type CricketBallTap = BallOf<CricketWicketTap>;

/** A delivery as the ledger holds it, whoever recorded it: its dismissal may be any kind the engine takes. */
export type CricketBallSeen = BallOf<CricketWicketSeen>;

type BallOf<W> = {
  readonly bat: number;
  readonly extra: CricketExtra | null;
  readonly boundary: 4 | 6 | null;
  readonly wicket: W | null;
};

/** The event types More records (spec §4.8): each with the engine's own payload. */
export type CricketMoreType =
  | 'cricket.innings.declare'
  | 'cricket.innings.close'
  | 'cricket.interruption'
  | 'cricket.revise'
  | 'cricket.newball'
  | 'cricket.powerplay'
  | 'cricket.followon'
  | 'cricket.match.close'
  | 'cricket.review';

/** Why a bowler left an over (CK-BC-1, Law 17.8), or not said. */
export type CricketChangeReason = 'incapacitated' | 'suspended' | 'other';

/** Why a batter retired (`cricket.retire`). */
export type CricketRetireReason = 'hurt' | 'out' | 'other';

/** One tap the scorer can make on the cricket pad. */
export type CricketTap =
  | { readonly kind: 'toss'; readonly wonBy: PadSide; readonly elected: 'bat' | 'bowl' }
  | { readonly kind: 'start' }
  | { readonly kind: 'ball'; readonly ball: CricketBallTap }
  | {
      readonly kind: 'summary';
      readonly runs: number;
      readonly wickets: number;
      readonly legalBalls: number;
    }
  | {
      readonly kind: 'retire';
      readonly person: string;
      readonly reason: CricketRetireReason;
      readonly incoming: string | null;
    }
  | { readonly kind: 'more'; readonly type: CricketMoreType; readonly payload: unknown }
  | {
      readonly kind: 'bowlerChange';
      readonly bowler: string;
      readonly reason: CricketChangeReason | null;
    };

/**
 * What an event on the ledger did, as the pad names it: the tap that records it, with a ball as the ledger holds it (a
 * console's ball may be out retired or timed out, which the pad never records).
 */
export type CricketSeenTap =
  | Exclude<CricketTap, { readonly kind: 'ball' }>
  | { readonly kind: 'ball'; readonly ball: CricketBallSeen };

/** A tap Undo names once it is taken back: any but the toss and the start, whose Undo returns to the screen before them. */
export type CricketUndoneTap = Exclude<CricketSeenTap, { readonly kind: 'toss' | 'start' }>;

/** What the last tap did (the tap that recorded it), or the tap Undo took back. */
export type CricketLastTap =
  CricketSeenTap | { readonly kind: 'undone'; readonly tap: CricketUndoneTap };

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the match stands, as the pad's screens divide it:
 * - `toss`: no toss yet; `setup`: tossed, not started (the batting order, the openers and the first bowler, §4.1);
 * - `live`: an innings is being scored, or the first is due and its picks are made;
 * - `break`: a later innings is due and its openers or its bowler are not picked yet (§4.5);
 * - `superOverSetup`: a super-over innings is due and its picks are not made (§4.6);
 * - `totals`: a side's players are not entered, or the innings under way was scored in over totals (§4.10);
 * - `tiedNoPlayers`: a tie goes to a super over that nobody can bat in (ruling 74);
 * - `decided`: the engine has a result.
 */
export type CricketStage =
  'toss' | 'setup' | 'live' | 'break' | 'superOverSetup' | 'totals' | 'tiedNoPlayers' | 'decided';

/**
 * An innings by its place: `i1` to `i4` for the main innings, `s1`, `s2`, … for the super over's, in the order they are
 * played. The pending picks are keyed by it.
 */
export type CricketOrdinal = `i${number}` | `s${number}`;

/** A side as the pad names it: the entrant's name as the organiser typed it, and its id. */
export type CricketSide = { readonly name: string; readonly entrantId: string };

/** The chase: the runs still needed, the legal balls left (none in an innings without a limit), and the target. */
export type CricketChase = {
  readonly need: number;
  readonly balls: number | null;
  readonly target: number;
};

/** The innings now: the one under way, else the one due, else the last played. */
export type CricketInnings = {
  readonly ordinal: CricketOrdinal;
  readonly superOver: boolean;
  readonly batting: PadSide;
  readonly runs: number;
  readonly wickets: number;
  readonly legalBalls: number;
  readonly ballsLimit: number | null;
  readonly chase: CricketChase | null;
};

/** A batter at the crease: runs and balls faced in this innings. */
export type BatterLine = {
  readonly id: string;
  readonly name: string;
  readonly runs: number;
  readonly balls: number;
};

/** The bowler of the over under way (the fold's), else the over's pick; `figures` are O-M-R-W off the scorecard. */
export type CricketBowler = {
  readonly id: string;
  readonly name: string;
  readonly figures: string;
};

/** One delivery of the over under way, as the strip shows it (`·`, runs, `wd`, `nb`, `b`, `lb`, `W`). */
export type OverChip = {
  readonly text: string;
  readonly tone: 'dot' | 'run' | 'boundary' | 'extra' | 'wicket';
};

/** A player of a side's batting order (the engine's: starters who play), and whether the team sheet names the keeper. */
export type CricketPlayer = {
  readonly id: string;
  readonly name: string;
  readonly keeper: boolean;
};

/**
 * How a decided match was decided: the engine's margin when it was won on the field (`CRICKET_MARGIN_KINDS`), else the
 * outcome's own kind (a tie, a draw, no result, an award). The words are the dictionary's (`cricketResult.ts`).
 */
export type CricketResultHow =
  | CricketMargin
  | { readonly kind: 'win' | 'tie' | 'draw' | 'no_result' | 'award' | 'double_walkover' };

export type CricketResult = { readonly margin: CricketResultHow; readonly winner: PadSide | null };

/** A cricket match as the pad shows it, folded from the ledger and this phone's queued taps, with its pending picks. */
export type CricketDisplay = {
  /** The sides, home first. */
  readonly sides: Readonly<Record<PadSide, CricketSide>>;
  readonly context: MatchContext;
  readonly stage: CricketStage;
  readonly toss: { readonly wonBy: PadSide; readonly elected: 'bat' | 'bowl' } | null;
  readonly innings: CricketInnings | null;
  /** Who is at the crease for the next ball: the fold's pair, a standing swap's, the openers' pick or a super over's replacement. */
  readonly crease: { readonly striker: BatterLine; readonly nonStriker: BatterLine } | null;
  readonly bowler: CricketBowler | null;
  /** The engine's folded state, which a candidate ball can be applied to (preflight F7). */
  readonly state: CricketState;
  /** The over under way (counted from 1) and its deliveries. */
  readonly over: { readonly number: number; readonly chips: readonly OverChip[] };
  /**
   * The deliveries bowled in the innings now, legal and illegal (0 before it opens). A hand swap is keyed to the next of
   * them, so any delivery, a wide or a no-ball included, uses it up (the controller's ruling, Batch 2 fix round 1).
   */
  readonly deliveries: number;
  /** The next ball is a free hit (the engine's: a no-ball before it). */
  readonly freeHit: boolean;
  /** What the next ball cannot go without: the openers of an innings not yet opened, or the bowler of an over due. */
  readonly needs: 'openers' | 'bowler' | null;
  /** The batting side's order: the scorer's pick merged over the engine's (`orderFromLineup`). */
  readonly battingOrder: readonly string[];
  /** Each side's players, in the engine's batting order. */
  readonly players: Readonly<Record<PadSide, readonly CricketPlayer[]>>;
  /** Each side has the two players an innings opens with (`playersEntered`). */
  readonly entered: Readonly<Record<PadSide, boolean>>;
  readonly result: CricketResult | null;
  readonly scorecard: CricketScorecard;
  readonly cfg: CricketCfg;
  readonly lastTap: CricketLastTap | null;
  /** This phone's Undo has a standing tap of its own to take back. */
  readonly undoable: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// The sheets' steps
// ---------------------------------------------------------------------------------------------------------------

/**
 * One choice of a cricket sheet's step (S2-4 plan Task 11; preflight F12): the domain's own, which the hook maps to the
 * kit's `StepSheetFacts`. Its id goes back to the step that offered it. A choice in a `group` is a key in that group's row
 * (the runs of an extra: "0", "1", …), any other a full-width row (owner ruling 82: lime when it takes a tap).
 */
export type CricketStepOption = {
  readonly id: string;
  readonly label: PadVar<CricketPadKey>;
  readonly tone: 'standard' | 'destructive';
  /** Not offered now: greyed, with its reason (`note`). */
  readonly disabled?: boolean;
  readonly note?: PadVar<CricketPadKey> | null;
  /** The pick already made, or the one suggested: the heavier lime border. */
  readonly chosen?: boolean;
  /** The heading of the row of keys this choice sits in; none for a full-width row. */
  readonly group?: CricketPadKey;
};

/**
 * A step of a cricket sheet: its title, a line under it (or none), and its choices. `name` tells one step from the next
 * for the bounce window of a step appearing (`useJustShown`): the second touch of a double tap that moved the sheet on
 * lands on the next step's choices and is ignored.
 */
export type CricketStep = {
  readonly name: string;
  readonly title: PadText<CricketPadKey>;
  readonly body: PadVar<CricketPadKey> | null;
  readonly options: readonly CricketStepOption[];
};

/** A word with a count: the `.other` key a counted text names (`PadCounted`), whose `.one` the language's rule may pick. */
type Counted<Base extends string> = `${Base}.other`;

/** The rules table's keys (`cricketRules.ts`): a label and a value a row. */
export type CricketRuleKey =
  | `scoring.cricket.rules.${'overs' | 'over' | 'players' | 'bowler' | 'superOver' | 'followOn' | 'reviews'}.label`
  | `scoring.cricket.rules.${'overs' | 'over' | 'players' | 'followOn' | 'reviews'}.value`
  | 'scoring.cricket.rules.overs.unlimited'
  | Counted<'scoring.cricket.rules.bowler.value'>
  | 'scoring.cricket.rules.bowler.none'
  | `scoring.cricket.rules.superOver.${'on' | 'off'}`;

/** How a batter was out, in the scorebook's words (the engine's kinds; the web keeps them in English in every language). */
export type CricketOutKey =
  | 'scoring.cricket.out'
  | `scoring.cricket.out.kind.${CricketWicketKind}`
  | 'scoring.cricket.out.fielder'
  | 'scoring.cricket.out.fielders';

/** What a ball did: a dot, runs, a boundary, an extra with its runs, joined. */
export type CricketBallKey =
  | 'scoring.cricket.ball.dot'
  | 'scoring.cricket.ball.four'
  | 'scoring.cricket.ball.six'
  | 'scoring.cricket.ball.and'
  | Counted<`scoring.cricket.ball.${'runs' | CricketExtra['kind']}`>;

/** The words of an event no tap of the pad's reads back (and of one whose payload the pad cannot read), by its type. */
export type CricketEventKey = `scoring.cricket.event.${
  | 'toss'
  | 'ball'
  | 'superOverBall'
  | 'summary'
  | 'declare'
  | 'close'
  | 'matchClose'
  | 'interruption'
  | 'revise'
  | 'followOn'
  | 'playerLine'
  | 'retire'
  | 'newBall'
  | 'powerplay'
  | 'review'
  | 'bowlerChange'
  | 'forfeit'
  | 'abandon'
  | 'finalize'
  | 'note'
  | 'award'
  | 'suspend'
  | 'resume'
  | 'settle'
  | 'lineup'}`;

/** How a decided match was decided (`cricketResult.ts`): a key for every margin kind and every outcome kind. */
export type CricketResultKey =
  | Counted<`scoring.cricket.result.${'runs' | 'wickets' | 'innings_and_runs'}`>
  | `scoring.cricket.result.${'super_over' | 'boundary_count' | 'win' | 'award' | 'tie' | 'draw' | 'no_result' | 'double_walkover'}`;

/**
 * Every dictionary key the cricket pad and its History words name. The kit translates them as `MessageKey`, so each must
 * exist in en.json (`cricketPadWords.test.ts` holds it to that at compile time).
 */
/**
 * The board's words the domain names (`cricketBoard`): the chase, with or without a ball limit, and a free hit; and the
 * striker's, which the wicket steps' Who's out? says too (`cricketWicket`).
 */
export type CricketBoardKey =
  | Counted<'scoring.cricket.board.chase'>
  | 'scoring.cricket.board.need'
  | 'scoring.cricket.board.freeHit'
  | 'scoring.cricket.board.onStrike';

/** The pad's keys and its sheets' words (Tasks 11 to 15). */
export type CricketSheetKey =
  | `scoring.cricket.key.${'wide' | 'noBall' | 'bye' | 'legBye' | 'out' | 'more'}`
  | `scoring.cricket.extras.${'ran' | 'bat' | 'runs' | 'out'}`
  | `scoring.cricket.wicket.${'how' | 'who' | 'fielder' | 'assist' | 'completed' | 'incoming'}`
  | `scoring.cricket.wicket.${'noFielder' | 'noAssist' | 'isFielder' | 'retired' | 'nonStriker' | 'nextInOrder'}`
  | `scoring.cricket.wicket.kind.${CricketBallWicketKind}`;

export type CricketPadKey =
  | CricketRuleKey
  | CricketSheetKey
  | CricketOutKey
  | CricketBallKey
  | CricketEventKey
  | CricketResultKey
  | `scoring.cricket.last.${'start' | 'summary' | 'bowlerChange' | 'undone'}`
  | `scoring.cricket.last.toss.${'bat' | 'bowl'}`
  | `scoring.cricket.last.retire.${'hurt' | 'out' | 'plain'}`
  | `scoring.cricket.history.${'innings' | 'superOver' | 'before'}`
  | 'scoring.cricket.tallySaid'
  | 'scoring.cricket.tallyNone'
  | CricketBoardKey
  | 'scoring.pad.tap';

/** The types cricket's pad works in. */
export type CricketTypes = {
  readonly tap: CricketTap;
  readonly display: CricketDisplay;
  readonly padKey: CricketPadKey;
  readonly undone: CricketUndoneTap;
};
