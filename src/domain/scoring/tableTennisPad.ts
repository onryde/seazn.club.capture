import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { SetBasedSide } from '@/domain/scoring/setBasedSides';

/**
 * Table tennis on the pad, as types (plan S2-2 Task 3; the pad view is Task 5). Whoever keeps the score (the engine,
 * through `foldTableTennis`) decides every field of the display: the pad only draws them. Table tennis has its own
 * types beside badminton's (owner, 2026-11-02: pad per sport), though several are alike.
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
export type TableTennisGame = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly winner: PadSide;
};

/**
 * Not started (the Start screen: who serves first is not yet picked); started, before the match's first point; a game
 * under way; a game won and the next not yet started; the match over. Badminton's values, in a type of its own.
 */
export type TableTennisPhase = 'notStarted' | 'pre' | 'live' | 'betweenGames' | 'decided';

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
  /** Level in the endgame, where a side needs two clear: from the target less one (10–10; hardbat 20–20). */
  readonly deuce: boolean;
  readonly records: TableTennisRecords;
  readonly lastTap: TableTennisLastTap | null;
  /** This phone has a tap of its own that Undo can take back (owner, 2026-10-31: one Undo, own taps only). */
  readonly undoable: boolean;
};

/**
 * Every dictionary key the History words (and, in Task 5, the pad) name. The kit translates them as `MessageKey`, so
 * each must exist in en.json.
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
  | `scoring.tabletennis.card.${TableTennisSanctionLevel}`;

/** Table tennis's pad types: what the match runtime is generic over (`SportTypes`). */
export type TableTennisTypes = {
  readonly tap: TableTennisTap;
  readonly display: TableTennisDisplay;
  readonly padKey: TableTennisPadKey;
  readonly undone: TableTennisUndoneTap;
};
