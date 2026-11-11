import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { SetBasedGame, SetBasedPhase } from '@/domain/scoring/setBasedBoard';
import type { SetBasedSide } from '@/domain/scoring/setBasedSides';

/**
 * Volleyball's types (S2-6 Task 4; the controller's ruling), table tennis's `tableTennisPad.ts` types in a file of their
 * own so the fold can name them before the pad exists and the pad file holds functions only. Whoever keeps the score (the
 * engine, through `foldVolleyball`) decides every field of the display: the pad only draws them.
 */

/** FIVB's four-step ladder (`volleyballPadRules.sanctionLevels`, lightest first). */
export type VolleyballSanctionLevel = 'warning' | 'penalty' | 'expulsion' | 'disqualification';

/** A side's players as the organiser typed them (one name for a side with no players). */
export type VolleyballSide = SetBasedSide;

/**
 * One tap the scorer can make. `start` starts the match, the side picked serving first (ruling 179). `rally.serving` is
 * the held answer to Who serves first? (Start's pick, or the deciding set's toss, ruling 180), else null, and `servingAt`
 * the display's count of score events when it was made, null with it: an answer is valid at that score only
 * (`volleyballEventFor`). `sub` and `sanction` name people by id (a name is not a key), none for a side with no players.
 */
export type VolleyballTap =
  | { readonly kind: 'start'; readonly server: PadSide }
  | {
      readonly kind: 'rally';
      readonly side: PadSide;
      readonly serving: PadSide | null;
      readonly servingAt: number | null;
    }
  | { readonly kind: 'timeout'; readonly side: PadSide }
  | {
      readonly kind: 'sub';
      readonly side: PadSide;
      readonly off?: string;
      readonly on?: string;
    }
  | {
      readonly kind: 'sanction';
      readonly side: PadSide;
      readonly level: VolleyballSanctionLevel;
      readonly person: string | null;
    }
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number };

/** Whether a point won a set or the match. */
export type VolleyballWon = 'none' | 'game' | 'match';

/**
 * A person a record names: by the name the sheet gives, or (`name` null) a person the sheet no longer lists, which the
 * words call "Player" (ruling 183: never blank).
 */
export type VolleyballPerson = { readonly name: string | null };

/**
 * What the last tap did: a point says whether it won a set or the match and, in a set after the first, the serve it was
 * made with (`toss`: the deciding set's pick, ruling 183); `undone` names the tap Undo took back. The start names its first
 * server when the ledger or this phone's pick says it, else null.
 */
export type VolleyballLastTap =
  | { readonly kind: 'start'; readonly server: PadSide | null }
  | {
      readonly kind: 'rally';
      readonly side: PadSide;
      readonly won: VolleyballWon;
      readonly set: number;
      readonly toss: PadSide | null;
    }
  | { readonly kind: 'timeout'; readonly side: PadSide }
  | {
      readonly kind: 'sub';
      readonly side: PadSide;
      readonly off: VolleyballPerson | null;
      readonly on: VolleyballPerson | null;
    }
  | {
      readonly kind: 'sanction';
      readonly side: PadSide;
      readonly level: VolleyballSanctionLevel;
      readonly person: VolleyballPerson | null;
    }
  | { readonly kind: 'setScore'; readonly first: number; readonly second: number }
  | { readonly kind: 'undone'; readonly tap: VolleyballUndoneTap };

/** What a tap did when it was recorded: never an Undo (History lists Undo on the tap it took back). */
export type VolleyballDone = Exclude<VolleyballLastTap, { readonly kind: 'undone' }>;

/** A tap Undo took back, as the last-tap line names it: never the start, whose Undo returns to the Start screen. */
export type VolleyballUndoneTap = Exclude<VolleyballDone, { readonly kind: 'start' }>;

/** A set over: each side's points when it ended, and the side that won it. */
export type VolleyballSet = SetBasedGame;

export type VolleyballPhase = SetBasedPhase;

/** The match's rules, read through the engine from its config (`volleyballPadRules`): never a number of ours. */
export type VolleyballRules = {
  readonly bestOf: number;
  readonly setTo: number;
  readonly finalSetTo: number;
  readonly winBy: number;
  /** The most a set's score may be set to (Set score's steppers). */
  readonly scoreBound: number;
};

/** Which things the match records: its config's `records`, so a pad offers no tool the engine would refuse. */
export type VolleyballRecords = {
  readonly timeouts: boolean;
  readonly sanctions: boolean;
  readonly substitutions: boolean;
};

/** What the next point means at level scores in the endgame (the engine's `deuceNote`): none below it. */
export type VolleyballNote = 'setting' | 'goldenPoint' | null;

/** A side's timeouts and substitutions in the set under way (ruling 175), from the stream. */
export type VolleyballCounts = { readonly timeouts: number; readonly subs: number };

/** FIVB's numbers for the match's variant: timeouts and substitutions a set (beach: one, none). */
export type VolleyballCaps = { readonly timeouts: 2 | 1; readonly subs: 6 | 0 };

/**
 * A volleyball match as the pad shows it. The serve is the engine's (`setBasedServeContext`); before the match's first
 * point the Start pick shows in its place, and at the deciding set's 0-0 nothing does until the toss is answered.
 */
export type VolleyballDisplay = {
  readonly sides: Readonly<Record<PadSide, VolleyballSide>>;
  readonly context: MatchContext;
  /** The set under way, or about to start; the last one's final score once the match is decided. */
  readonly points: Readonly<Record<PadSide, number>>;
  /** Every set over, in order. */
  readonly finished: readonly VolleyballSet[];
  /** The set under way, or about to start; the last one once decided. */
  readonly set: number;
  /** The set's target: the first sets' `setTo`, the deciding set's `finalSetTo`. */
  readonly target: number;
  readonly rules: VolleyballRules;
  readonly phase: VolleyballPhase;
  /** Beach, not indoor (the config records no substitutions): pairs, no Sub, one timeout. */
  readonly beach: boolean;
  /**
   * The side due to serve, or null when the ledger does not say. It may be this phone's Start pick, which no ledger event
   * has named: then `serverPicked` is true.
   */
  readonly serving: PadSide | null;
  readonly serverPicked: boolean;
  /** Beach only: the serving player's name and id when the engine names one from the pair order; else null. */
  readonly serverPerson: string | null;
  readonly serverPersonId: string | null;
  /**
   * Nobody can say who serves and this phone's pick is not standing in: the engine's `deciding-set-toss` at a set 0-0, or
   * a match started elsewhere. The pad offers Who serves first in set {n}?.
   */
  readonly anchorNeeded: boolean;
  /**
   * The score events standing in the scorer's view (rallies and set scores no void takes back, this phone's legal queued
   * taps on top): a `serving` stamp is valid only at the count it was made at (`volleyballPayloadForSend`).
   */
  readonly scoreEvents: number;
  readonly note: VolleyballNote;
  readonly counts: Readonly<Record<PadSide, VolleyballCounts>>;
  readonly caps: VolleyballCaps;
  /** The heaviest sanction each side holds in the set under way (a per-set walk; an undone one is not counted). */
  readonly heaviest: Readonly<Record<PadSide, VolleyballSanctionLevel | null>>;
  readonly records: VolleyballRecords;
  readonly lastTap: VolleyballLastTap | null;
  /** This phone has a tap of its own that Undo can take back (owner, 2026-10-31: one Undo, own taps only). */
  readonly undoable: boolean;
};

/** Every dictionary key the pad and its History words name (`MessageKey`s, so each must exist in en.json). */
export type VolleyballPadKey =
  | 'scoring.volleyball.setHeading'
  | 'scoring.volleyball.last.start'
  | 'scoring.volleyball.last.startUnknownServer'
  | 'scoring.volleyball.last.rally'
  | 'scoring.volleyball.last.set'
  | 'scoring.volleyball.last.match'
  | 'scoring.volleyball.last.toss'
  | 'scoring.volleyball.last.timeout'
  | 'scoring.volleyball.last.sub'
  | 'scoring.volleyball.last.subNamed'
  | 'scoring.volleyball.last.sanction'
  | 'scoring.volleyball.last.setScore'
  | 'scoring.volleyball.undone.rally'
  | 'scoring.volleyball.undone.timeout'
  | 'scoring.volleyball.undone.sub'
  | 'scoring.volleyball.undone.sanction'
  | 'scoring.volleyball.undone.setScore'
  | `scoring.sanction.${VolleyballSanctionLevel}`
  | 'scoring.volleyball.player'
  | 'scoring.volleyball.setsSaid.other'
  | 'scoring.volleyball.setsTally'
  | 'scoring.volleyball.setOf'
  | 'scoring.volleyball.target'
  | 'scoring.volleyball.hint'
  | 'scoring.volleyball.start.ask'
  | 'scoring.volleyball.serving'
  | 'scoring.volleyball.servingSaid'
  | 'scoring.volleyball.serverPerson'
  | 'scoring.volleyball.note.setting'
  | 'scoring.volleyball.note.goldenPoint'
  | 'scoring.volleyball.foot.indoor'
  | 'scoring.volleyball.foot.beach'
  | 'scoring.volleyball.tool.setScore'
  | 'scoring.volleyball.tool.timeout'
  | 'scoring.volleyball.tool.sub'
  | 'scoring.volleyball.tool.serving'
  | 'scoring.volleyball.tool.more'
  | 'scoring.volleyball.sheet.timeout'
  | 'scoring.volleyball.sheet.sub'
  | 'scoring.volleyball.sheet.off'
  | 'scoring.volleyball.sheet.on'
  | 'scoring.volleyball.sheet.serving'
  | 'scoring.volleyball.more.sanction'
  | 'scoring.volleyball.done.penalty'
  | 'scoring.volleyball.done.fieldSix'
  | 'scoring.volleyball.done.fieldTwo'
  | 'scoring.volleyball.held';

/** Volleyball's pad types: what the match runtime is generic over (`SportTypes`). */
export type VolleyballTypes = {
  readonly tap: VolleyballTap;
  readonly display: VolleyballDisplay;
  readonly padKey: VolleyballPadKey;
  readonly undone: VolleyballUndoneTap;
};
