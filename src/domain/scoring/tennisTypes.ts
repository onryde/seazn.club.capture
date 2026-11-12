import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { SetBasedSide } from '@/domain/scoring/setBasedSides';
import type { TennisCfg } from '@/domain/scoring/tennisEngine';

/**
 * Tennis's types (S2-7 Task 4; rulings 215-229), volleyball's `volleyballTypes.ts` in a file of its own so the fold, the
 * events and later the pad can name them. Whoever keeps the score (the engine, through `foldTennis`) decides every field of
 * the display: the pad only draws them. The top half is `home`, the bottom `away`.
 */

/** The ladder a phone sends, lightest first: `tennisPadRules.sanctionLevels` without `default` (ruling 218). */
export type TennisLevel = 'warning' | 'point_penalty' | 'game_penalty';

/** A level as read from the web: the phone never sends `default`, but the organiser's console does. */
export type TennisSeenLevel = TennisLevel | 'default';

/** A break's kind (`tennisPadRules.interruptionKinds`, ruling 220). */
export type TennisBreakKind = 'medical' | 'toilet' | 'heat' | 'other';

/**
 * One tap the scorer can make. `violation.person` is a bootstrap person id (a doubles side's player), null for the side
 * alone; `break.side` null is "Both / none"; `setScore.tb` is the tie-break's points, null for a set without one.
 */
export type TennisTap =
  | { readonly kind: 'start' }
  /** Who serves the first game, asked at Start and queued before it (ruling 233); `side` is the pad's top or bottom half. */
  | { readonly kind: 'toss'; readonly side: PadSide }
  | { readonly kind: 'point'; readonly side: PadSide }
  | {
      readonly kind: 'setScore';
      readonly first: number;
      readonly second: number;
      readonly tb: { readonly first: number; readonly second: number } | null;
    }
  | {
      readonly kind: 'violation';
      readonly side: PadSide;
      readonly level: TennisLevel;
      readonly person: string | null;
    }
  | { readonly kind: 'award'; readonly side: PadSide }
  | { readonly kind: 'break'; readonly breakKind: TennisBreakKind; readonly side: PadSide | null };

/** What a point closed: nothing, a game, a set or the match. */
export type TennisWon = 'none' | 'game' | 'set' | 'match';

/** A person a record names: by the name the sheet gives, or (`name` null) one the sheet no longer lists. */
export type TennisPerson = { readonly name: string | null };

/** What the last tap did; `undone` names the tap Undo took back. */
export type TennisLastTap =
  | { readonly kind: 'start' }
  | { readonly kind: 'toss'; readonly side: PadSide }
  | {
      readonly kind: 'point';
      readonly side: PadSide;
      readonly set: number;
      readonly won: TennisWon;
    }
  | {
      readonly kind: 'setScore';
      readonly first: number;
      readonly second: number;
      readonly tb: { readonly first: number; readonly second: number } | null;
    }
  | {
      readonly kind: 'violation';
      readonly side: PadSide;
      readonly level: TennisSeenLevel;
      readonly person: TennisPerson | null;
    }
  | { readonly kind: 'award'; readonly side: PadSide }
  | { readonly kind: 'break'; readonly breakKind: TennisBreakKind; readonly side: PadSide | null }
  /** The organiser's forfeit or abandon, read off the web's ledger: the phone never sends it. */
  | {
      readonly kind: 'ending';
      readonly ending: TennisEnding['kind'];
      readonly side: PadSide | null;
    }
  | { readonly kind: 'undone'; readonly tap: TennisUndoneTap };

/** What a tap did when it was recorded: never an Undo. */
export type TennisDone = Exclude<TennisLastTap, { readonly kind: 'undone' }>;

/**
 * A tap Undo took back, as the last-tap line names it: never the start, whose Undo returns to the Start screen (taking its
 * toss with it), nor the toss itself, and never an ending, which is the organiser's and no phone's Undo takes.
 */
export type TennisUndoneTap = Exclude<TennisDone, { readonly kind: 'start' | 'toss' | 'ending' }>;

/**
 * A set over, as the engine banks it: the games each side won, the tie-break's points when it was a tie-break set, and
 * whether it was a match tie-break decider (whose "games" are its points). `text` is the one-line form the result and the
 * strip use ("7–6(5)", "3–6", "[10–7]"): numbers and punctuation, never translated.
 */
export type TennisSetLine = {
  readonly first: number;
  readonly second: number;
  readonly winner: PadSide;
  readonly tiebreak: { readonly first: number; readonly second: number } | null;
  readonly matchTiebreak: boolean;
  readonly text: string;
};

/** How the organiser ended the match (ruling 225, G2); `side` is the side at fault, null when neither is. */
export type TennisEnding = {
  readonly kind: 'retired' | 'defaulted' | 'walkover' | 'withdrew' | 'abandoned';
  readonly side: PadSide | null;
};

/** Not started; under way; won on court; ended by the organiser. */
export type TennisPhase = 'notStarted' | 'live' | 'decided' | 'ended';

/** A game's call for one side: 0, 15, 30, 40, AD, or a breaker's points as a number. */
export type TennisCall = string;

export type TennisDisplay = {
  readonly sides: Readonly<Record<PadSide, SetBasedSide>>;
  readonly doubles: boolean;
  readonly context: MatchContext;
  readonly cfg: TennisCfg;
  readonly phase: TennisPhase;
  /** The set under way, or about to start; the last one once the match is decided. */
  readonly set: number;
  /** The games of that set. */
  readonly games: Readonly<Record<PadSide, number>>;
  readonly call: Readonly<Record<PadSide, TennisCall>>;
  readonly breaker: 'tiebreak' | 'matchTiebreak' | null;
  readonly note: 'deuce' | 'decidingPoint' | null;
  readonly endsChanged: boolean;
  /** The engine's serving side, or null when it cannot name one (`serveContext.serveOrderKnown` false, F1). */
  readonly serving: PadSide | null;
  /**
   * The doubles server's name, only when the engine names the order and the player and no breaker is in force (ruling 235:
   * `serveOrderKnown && personId && !breakerInForce`); else none, and the side's plate stands alone. Singles has none.
   */
  readonly servingPerson: string | null;
  /** The side the match's toss named to serve first (the engine's `opener`), or null while no toss is held (ruling 233). */
  readonly toss: PadSide | null;
  readonly setsWon: Readonly<Record<PadSide, number>>;
  readonly finished: readonly TennisSetLine[];
  /** The heaviest violation each side holds in the set under way (a per-set walk; an undone one is not counted). */
  readonly heaviest: Readonly<Record<PadSide, TennisSeenLevel | null>>;
  /** The points and set scores standing in the scorer's view, this phone's legal queued taps on top. */
  readonly scoreEvents: number;
  readonly ending: TennisEnding | null;
  /** A `default` is recorded and the organiser's forfeit has not landed: the engine refuses every tap (G1). */
  readonly endingPending: boolean;
  readonly lastTap: TennisLastTap | null;
  /** This phone has a tap of its own that Undo can take back. */
  readonly undoable: boolean;
};

/**
 * Every dictionary key the pad names (`MessageKey`s, so each must exist in en.json): the strip, the halves, the tool row, the
 * level words, the rules rows and the endings, the violation, award and break steps' (Task 7) and History's words (Task 8).
 */
export type TennisPadKey =
  | 'scoring.tennis.hint'
  | 'scoring.tennis.start.ask'
  | 'scoring.tennis.setOf'
  | 'scoring.tennis.setsTally'
  | 'scoring.tennis.breaker.tiebreak'
  | 'scoring.tennis.breaker.matchTiebreak'
  | 'scoring.tennis.note.deuce'
  | 'scoring.tennis.note.decidingPoint'
  | 'scoring.tennis.endsChange'
  | 'scoring.tennis.endingPending'
  | 'scoring.tennis.serving'
  | 'scoring.tennis.serverPerson'
  | 'scoring.tennis.foot.games'
  | 'scoring.tennis.foot.gamesSaid'
  | 'scoring.tennis.tool.violation'
  | 'scoring.tennis.tool.violationShort'
  | 'scoring.tennis.tool.break'
  | 'scoring.tennis.tool.award'
  | 'scoring.tennis.tool.awardShort'
  | 'scoring.tennis.tool.setScore'
  | 'scoring.tennis.level.warning'
  | 'scoring.tennis.level.pointPenalty'
  | 'scoring.tennis.level.gamePenalty'
  | 'scoring.tennis.level.default'
  | 'scoring.tennis.rules.format.label'
  | 'scoring.tennis.rules.bestOf'
  | 'scoring.tennis.rules.set.label'
  | 'scoring.tennis.rules.gamesTo'
  | 'scoring.tennis.rules.tiebreak.label'
  | 'scoring.tennis.rules.tiebreakAt'
  | 'scoring.tennis.rules.noTiebreak'
  | 'scoring.tennis.rules.game.label'
  | 'scoring.tennis.rules.noAd'
  | 'scoring.tennis.rules.finalSet.label'
  | 'scoring.tennis.rules.finalMatchTiebreak'
  | 'scoring.tennis.rules.finalTiebreak'
  | 'scoring.tennis.ending.retired'
  | 'scoring.tennis.ending.defaulted'
  | 'scoring.tennis.ending.walkover'
  | 'scoring.tennis.ending.withdrew'
  | 'scoring.tennis.ending.abandoned'
  | 'scoring.tennis.ending.by'
  | 'scoring.tennis.result'
  | 'scoring.tennis.violation.title'
  | 'scoring.tennis.violation.who'
  | 'scoring.tennis.violation.confirm.title'
  | 'scoring.tennis.violation.confirm.body'
  | 'scoring.tennis.violation.confirm.action'
  | 'scoring.tennis.violation.done.point'
  | 'scoring.tennis.violation.done.game'
  | 'scoring.tennis.violation.done.breaker'
  | 'scoring.tennis.award.title'
  | 'scoring.tennis.award.ask'
  | 'scoring.tennis.award.confirm.title'
  | 'scoring.tennis.award.confirm.body'
  | 'scoring.tennis.award.confirm.action'
  | 'scoring.tennis.break.title'
  | 'scoring.tennis.break.askKind'
  | 'scoring.tennis.break.askSide'
  | 'scoring.tennis.break.kind.medical'
  | 'scoring.tennis.break.kind.toilet'
  | 'scoring.tennis.break.kind.heat'
  | 'scoring.tennis.break.kind.other'
  | 'scoring.tennis.break.both'
  | 'scoring.tennis.setHeading'
  | 'scoring.tennis.player'
  | 'scoring.tennis.last.start'
  | 'scoring.tennis.last.toss'
  | 'scoring.tennis.last.point'
  | 'scoring.tennis.last.game'
  | 'scoring.tennis.last.set'
  | 'scoring.tennis.last.match'
  | 'scoring.tennis.last.setScore'
  | 'scoring.tennis.last.violation'
  | 'scoring.tennis.last.award'
  | 'scoring.tennis.last.break'
  | 'scoring.tennis.last.breakFor'
  | 'scoring.tennis.undone.point'
  | 'scoring.tennis.undone.setScore'
  | 'scoring.tennis.undone.violation'
  | 'scoring.tennis.undone.award'
  | 'scoring.tennis.undone.break';

/** Tennis's pad types: what the match runtime is generic over (`SportTypes`). */
export type TennisTypes = {
  readonly tap: TennisTap;
  readonly display: TennisDisplay;
  readonly padKey: TennisPadKey;
  readonly undone: TennisUndoneTap;
};
