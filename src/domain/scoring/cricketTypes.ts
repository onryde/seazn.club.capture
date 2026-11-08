import type {
  CricketBallEv,
  CricketCfg,
  CricketMargin,
  CricketScorecard,
  CricketState,
} from '@seazn/engine/sports/cricket';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * Cricket on the pad: the types (S2-4 spec §4 to §6, plan Task 5). The match is the engine's cricket module; its state is a
 * fold of the web's ledger by `@seazn/engine`, and these types are only what the pad needs of it. Every cricket rule is the
 * engine's: the display reads the fold off, and carries the effect of the scorer's pending picks (`cricketPicks.ts`), which
 * the server records only when a later ball carries them.
 */

// ---------------------------------------------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------------------------------------------

/** How a batter is out, in the engine's own words (`CricketWicket.kind`). */
export type CricketWicketKind = NonNullable<CricketBallEv['wicket']>['kind'];

/** An extra, in the engine's own words: its kind, and the runs it adds (a wide's own run included). */
export type CricketExtra = NonNullable<CricketBallEv['runs']['extras']>;

/** A dismissal on a ball: how, who, the fielder and a second one (a run out's), and who walks in. */
export type CricketWicketTap = {
  readonly kind: CricketWicketKind;
  readonly out: string;
  readonly fielder: string | null;
  readonly fielderAssist: string | null;
  readonly incoming: string | null;
};

/**
 * One delivery as the scorer taps it: runs off the bat, one extra or none, a boundary (the 4 and 6 keys, ruling 73), a
 * dismissal or none. Who bats and bowls is the display's (its crease and its bowler), never the tap's.
 */
export type CricketBallTap = {
  readonly bat: number;
  readonly extra: CricketExtra | null;
  readonly boundary: 4 | 6 | null;
  readonly wicket: CricketWicketTap | null;
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

/** A tap Undo names once it is taken back: any but the toss and the start, whose Undo returns to the screen before them. */
export type CricketUndoneTap = Exclude<CricketTap, { readonly kind: 'toss' | 'start' }>;

/** What the last tap did (the tap that recorded it), or the tap Undo took back. */
export type CricketLastTap =
  CricketTap | { readonly kind: 'undone'; readonly tap: CricketUndoneTap };

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

/**
 * Every dictionary key the cricket pad and its History words name (Task 7 writes them, with the dictionaries). The kit
 * translates them as `MessageKey`, so each must exist in en.json.
 */
export type CricketPadKey = never;

/** The types cricket's pad works in. */
export type CricketTypes = {
  readonly tap: CricketTap;
  readonly display: CricketDisplay;
  readonly padKey: CricketPadKey;
  readonly undone: CricketUndoneTap;
};
