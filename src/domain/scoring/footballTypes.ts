import type { GameTime } from '@seazn/engine/core';
import type { FootballCfg } from '@seazn/engine/sports/football';
import type { ClockAnchor } from '@/domain/scoring/footballClock';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * Football on the pad: the types (S2-5 design §6, §8; plan P Tasks 6–7). The match is the engine's football module; the
 * state is a fold of the web's ledger by `@seazn/engine`, and these are only what the pad needs of it. Persons are named
 * by id on the wire and by name and shirt number on the screen; neither ever reaches the record.
 */

/** A player as the pad names one: `#9 Okafor`, or the name alone with no shirt number (§6.3). */
export type FootballPlayer = {
  readonly personId: string;
  readonly name: string;
  readonly number: number | null;
};

/** A player as the sheets and the last-tap line name one: `#9 Okafor`, or the name alone with no shirt number (§6.3). */
export const playerLabel = (player: FootballPlayer): string =>
  player.number === null ? player.name : `#${player.number} ${player.name}`;

/** A player in the least room: `#9`, or the name alone with no shirt number (the bin mark, the sub line: §6.2, §6.7). */
export const playerMark = (player: FootballPlayer): string =>
  player.number === null ? player.name : `#${player.number}`;

/** A player serving a temporary dismissal, and when it is over (the engine's `expiresAt`), if it says. */
export type FootballBinned = {
  readonly person: FootballPlayer | null;
  readonly expiresAt: GameTime | null;
};

/** One team as the pad draws its column (§6.2) and its sheets list its players (§6.3). */
export type FootballSide = {
  readonly entrantId: string;
  /** The team's name as the organiser typed it. Never translated. */
  readonly name: string;
  /** Whether the bootstrap carried the team sheet (§6.6): without it the pad names no player. */
  readonly sheet: boolean;
  readonly onPitch: readonly FootballPlayer[];
  readonly bench: readonly FootballPlayer[];
  /** Who may come on: the engine's bench (with rolling subs, the player who came off is back on it) less anyone sent off. */
  readonly offeredOn: readonly FootballPlayer[];
  /** Who may be booked: on the pitch, the bench, those who came off, those in the bin and the officials, less the sent off. */
  readonly cardable: readonly FootballPlayer[];
  /** Persons holding a yellow card: only they may be shown a second one. */
  readonly yellowed: readonly string[];
  readonly sentOff: readonly string[];
  readonly sinBin: readonly FootballBinned[];
  /** The team's cards, for its marks: `red` counts a straight red and a second yellow alike. */
  readonly cards: { readonly yellow: number; readonly red: number };
};

/** Before the start; the match in play (any period); the shootout; over (decided, finalized or abandoned). */
export type FootballPadPhase = 'notStarted' | 'play' | 'shootout' | 'decided';

/** The football period markers (`football.period`'s `phase`): the whistle that ends a period. */
export type FootballMarker = 'HT' | 'FT' | 'QT' | '3QT' | 'ET_HT' | 'ET_FT';

/**
 * What a standing event did, as the last-tap line and History say it. A goal's `side` is the side CREDITED (an own goal
 * by an away player is home's goal); its `scorer` is whoever put it in. `at` is the event's stamp, or null.
 */
export type FootballDone =
  | { readonly kind: 'start' }
  | { readonly kind: 'clock'; readonly running: boolean; readonly at: GameTime | null }
  /** A clock event that moved the time and nothing else (`correctionsIn`): a Correct, a resync, a second Start. */
  | { readonly kind: 'clockCorrect'; readonly at: GameTime | null }
  | {
      readonly kind: 'goal';
      readonly side: PadSide;
      readonly scorer: FootballPlayer | null;
      readonly ownGoal: boolean;
      readonly penalty: boolean;
      readonly at: GameTime | null;
    }
  | {
      readonly kind: 'card';
      readonly side: PadSide;
      readonly color: string;
      readonly person: FootballPlayer | null;
      readonly at: GameTime | null;
    }
  | {
      readonly kind: 'sub';
      readonly side: PadSide;
      readonly off: FootballPlayer;
      readonly on: FootballPlayer;
      readonly at: GameTime | null;
    }
  | { readonly kind: 'period'; readonly marker: string; readonly at: GameTime | null }
  | {
      readonly kind: 'penaltyMiss';
      readonly side: PadSide;
      readonly taker: FootballPlayer | null;
      readonly outcome: string;
      readonly at: GameTime | null;
    }
  | {
      readonly kind: 'sinBin' | 'sinBinEnd';
      readonly side: PadSide;
      readonly person: FootballPlayer | null;
      readonly at: GameTime | null;
    }
  | {
      readonly kind: 'shot';
      readonly side: PadSide;
      readonly taker: FootballPlayer | null;
      readonly outcome: string;
      readonly at: GameTime | null;
    }
  | {
      readonly kind: 'kick';
      readonly side: PadSide;
      readonly person: FootballPlayer | null;
      readonly scored: boolean;
    };

/** What the last tap did, or the one Undo took back. */
export type FootballLastTap =
  FootballDone | { readonly kind: 'undone'; readonly tap: FootballDone };

/** The shootout as the pad draws it: each kick by side in order, whose kick is next (the engine's word), and the kicks scored. */
export type FootballShootout = {
  readonly kicks: readonly { readonly side: PadSide; readonly scored: boolean }[];
  readonly next: PadSide | null;
  readonly scored: Readonly<Record<PadSide, number>>;
};

/** A football match as the pad shows it, folded from the ledger and this phone's queued taps. */
export type FootballDisplay = {
  readonly phase: FootballPadPhase;
  /** The engine's own phase (`pre`, `H1` … `ET_H2`, `SHOOTOUT`, `done`, `final`, `abandoned`): stamps name it. */
  readonly enginePhase: string;
  readonly cfg: FootballCfg;
  readonly context: MatchContext;
  readonly sides: Readonly<Record<PadSide, FootballSide>>;
  readonly goals: Readonly<Record<PadSide, number>>;
  readonly shootout: FootballShootout | null;
  readonly clock: {
    /** The shared clock's anchor in the current phase (design §7.2), or none: it reads 0, stopped. */
    readonly anchor: ClockAnchor | null;
    /** The current phase's first Start stands (`periodStarted`): Correct is offered only then (fix-round ruling e). */
    readonly started: boolean;
    /** The engine's `asOf`: the newest stamp folded, the floor a new stamp in its period may not go below. */
    readonly asOf: GameTime | null;
    /** The play phase whose ending marker stands with no clock event since (the clock bar's break word), or null. */
    readonly justEnded: string | null;
  };
  /** The period marker the engine takes now (End of period's), or null. */
  readonly marker: FootballMarker | null;
  /** Whether each team may still substitute, in the engine's judgement (`maxSubs`, `subWindows`). */
  readonly subsLeft: Readonly<Record<PadSide, boolean>>;
  readonly lastTap: FootballLastTap | null;
  /** This phone's Undo has something to take back. */
  readonly undoable: boolean;
  /** Anything stands after the start: End of period is offered only then, never tied to the clock. */
  readonly kickedOff: boolean;
  /**
   * The ledger's tip this display was folded over (its newest seq, 0 for none): a clock tap made on it carries it as its
   * `base`, so its send tells another screen's later clock event from one the scorer saw (`overtaken`).
   */
  readonly ledgerTip: number;
};

/**
 * One tap the scorer makes (design §8). `side` is always the column the tap was made in; `stamp` is the clock's reading
 * captured when the button that opened the sheet was pressed (null when the clock had no anchor), and the event's `at` is
 * made from it against the display (`stampFor`). Persons are ids; null is "Don't know" or "No assist", never sent.
 */
export type FootballTap =
  | { readonly kind: 'start' }
  | { readonly kind: 'clock'; readonly running: boolean; readonly elapsed: number }
  | {
      readonly kind: 'goal';
      readonly side: PadSide;
      readonly scorer: string | null;
      readonly assist: string | null;
      readonly penalty: boolean;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'ownGoal';
      readonly side: PadSide;
      readonly scorer: string | null;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'card';
      readonly side: PadSide;
      readonly person: string | null;
      readonly color: string;
      readonly reason: string | null;
      readonly stamp: GameTime | null;
    }
  | { readonly kind: 'sub'; readonly side: PadSide; readonly off: string; readonly on: string }
  | { readonly kind: 'period'; readonly stamp: GameTime | null }
  | {
      readonly kind: 'penaltyMiss';
      readonly side: PadSide;
      readonly taker: string | null;
      readonly goalkeeper: string | null;
      readonly outcome: string;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'sinBin';
      readonly side: PadSide;
      readonly person: string | null;
      readonly reason: string | null;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'sinBinEnd';
      readonly side: PadSide;
      readonly person: string | null;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'shot';
      readonly side: PadSide;
      readonly taker: string | null;
      readonly outcome: string;
      readonly stamp: GameTime | null;
    }
  | {
      readonly kind: 'kick';
      readonly side: PadSide;
      readonly person: string | null;
      readonly scored: boolean;
    };

/** The words for a period on the clock bar and History's headings: the engine's play phases, the first quarter, the kicks. */
export type FootballPeriodWord =
  'H1' | 'H2' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'ET_H1' | 'ET_H2' | 'shootout';

/** The clock bar's word between two periods, from the period that just ended. */
export type FootballBreakWord = 'halfTime' | 'quarterTime' | 'fullTime' | 'etHalfTime';

/** The card colours the engine lists (`footballPadRules.cardColors`), each with its words. */
export type FootballCardWord = 'yellow' | 'second_yellow' | 'red';

/** The outcomes of a missed penalty and of a shot the engine lists, each with its words. */
export type FootballOutcomeWord = 'saved' | 'missed' | 'post' | 'blocked' | 'scored';

/**
 * Every dictionary key the pad, its board, History and its rules rows name. The kit translates them as `MessageKey`, so
 * each must exist in en.json (`footballPad.test.ts` checks). The sheets' own words are the screen's.
 */
export type FootballPadKey =
  | `scoring.football.period.${FootballPeriodWord}`
  | `scoring.football.break.${FootballBreakWord}`
  | `scoring.football.end.${FootballMarker}`
  | `scoring.football.clock.${'start' | 'pause' | 'resume' | 'paused' | 'said'}`
  | `scoring.football.column.${'goal' | 'yellow' | 'red' | 'sub' | 'scored' | 'missed' | 'noSubs' | 'noSheet' | 'goalSaid' | 'scoredSaid'}`
  | `scoring.football.card.${FootballCardWord}`
  | `scoring.football.outcome.${FootballOutcomeWord}`
  | `scoring.football.more.${'penalty' | 'sinBin' | 'sinBinEnd' | 'shot' | 'correct' | 'details'}`
  | `scoring.football.note.${'extraTime' | 'penalties' | 'notStarted'}`
  | 'scoring.football.mark.sinBinOver'
  | `scoring.football.last.${FootballLastWord}`
  | `scoring.football.rules.${FootballRuleWord}`
  | 'scoring.football.start.ask'
  | 'scoring.football.tool.more'
  | 'scoring.football.tallySaid'
  | 'scoring.football.hint';

/** The last-tap line's sentences, one per thing an event did, and the one that says it was undone. */
export type FootballLastWord =
  | 'start'
  | 'clockStart'
  | 'clockPause'
  | 'clockCorrected'
  | 'goal'
  | 'penaltyGoal'
  | 'ownGoal'
  | 'card'
  | 'sub'
  | 'period'
  | 'penaltyMiss'
  | 'sinBin'
  | 'sinBinEnd'
  | 'shot'
  | 'kickScored'
  | 'kickMissed'
  | 'undone';

/** The rules rows' labels and values (Match details). A value with a count names its `.other` form (`PadCounted`). */
export type FootballRuleWord =
  | 'format'
  | 'periods'
  | 'extraTime'
  | 'shootout'
  | 'shootoutKicks.other'
  | 'subs'
  | 'subsRolling'
  | 'subsCapped.other'
  | 'subsMax'
  | 'subsWindows.other'
  | 'subsUnlimited'
  | 'sinBin'
  | 'minutes'
  | 'none';

/** Football's pad types: what the match runtime is generic over (`SportTypes`). */
export type FootballTypes = {
  readonly tap: FootballTap;
  readonly display: FootballDisplay;
  readonly padKey: FootballPadKey;
  readonly undone: FootballDone;
};

/** The engine's side of a seat: home is the first. */
export const ENGINE_SIDE: Readonly<Record<PadSide, 'home' | 'away'>> = {
  first: 'home',
  second: 'away',
};

/** The seat an engine side sits in. */
export const seatOf = (side: 'home' | 'away'): PadSide => (side === 'home' ? 'first' : 'second');

/** The other seat. */
export const otherSide = (side: PadSide): PadSide => (side === 'first' ? 'second' : 'first');
