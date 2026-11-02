import type { PadRefusal } from '@/domain/scoring/padLine';
import type { PadHistoryGroup, PadSide, PadSync, PadView } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';

/**
 * A sport, as the match runtime scores it (owner, 2026-11-02: "pad per sport must, instead of creating a single pad and
 * adjusting and adding lots of conditions"). The reducer (`scoringMatch.ts` and its parts), its view and the runner are
 * the same for every sport; what a sport decides is behind this port: how the ledger folds, what a tap is on the wire,
 * the payload a send goes with, and what the pad shows. A sport is a module (`badmintonSport.ts`), listed by its
 * bootstrap key in `sports.ts`; a second sport is a second module and a second screen, and nothing generic changes.
 *
 * The members are the operations the runtime calls, and no more: each is one question the reducer or its view asks.
 */

/** The types one sport's pad works in. */
export type SportTypes = {
  /** A tap the scorer makes on the sport's pad (badminton: a rally, a sanction, a set score, …). */
  readonly tap: unknown;
  /** The match as the sport's pad shows it, folded from the ledger and this phone's queued taps. */
  readonly display: unknown;
  /** Every dictionary key the sport's pad names (`PadView`'s `K`). */
  readonly padKey: string;
  /** A tap Undo took back while it was only queued, as the last-tap line names it. */
  readonly undone: unknown;
};

/** What a fold reads: the server's ledger with this phone's queued taps on top, as the sport's engine folds them. */
export type SportFoldInput = {
  readonly bootstrap: Bootstrap;
  /** The server's ledger, in seq order. */
  readonly ledger: readonly LedgerEvent[];
  /** This phone's queued taps, oldest first. */
  readonly queued: readonly QueuedEvent[];
  /** The ids of the events this phone recorded, the stand-ins built from accepted taps included (design §6.2). */
  readonly ownEventIds: readonly string[];
  /** The side this phone picked to serve first on the Start screen, or null. */
  readonly toss: PadSide | null;
};

/** A seat with no entrant; a config the engine's schema refuses; a ledger the engine will not replay. */
export type Unfoldable = 'sides' | 'cfg' | 'ledger';

export type SportFold<S extends SportTypes> =
  | {
      readonly kind: 'folded';
      readonly display: S['display'];
      /** The queued taps' keys the match still takes, in order: the one judge of a tap (sync's `revalidate`). */
      readonly legalQueued: readonly string[];
      readonly history: readonly PadHistoryGroup<S['padKey']>[];
    }
  | { readonly kind: 'unfoldable'; readonly reason: Unfoldable };

/** A tap as the event the server records. */
export type SportEvent = { readonly type: string; readonly payload: unknown };

/**
 * One sport behind the runtime. Members are methods, not function-valued properties, on purpose: a method's parameters
 * are compared both ways, so every sport is also an `AnySport` (what a runner holds before anything says which sport
 * a match is). The runtime never hands one sport's tap or display to another: a match keeps the sport it opened with
 * (`MatchState.sport`), and a screen reads only a match of its own sport (`viewAs`).
 */
export interface ScoringSport<S extends SportTypes> {
  /** The bootstrap's `sport_key` this sport scores. A match whose bootstrap names another is not folded by it. */
  readonly key: string;
  /** `foldEpochOf(key)`: the engine epoch this build folds the sport with, sent with every tap. */
  readonly epoch: number;

  // The match.
  /**
   * The ledger and the queue folded, as the pad draws them; the queued taps the match still takes. Asked many times a
   * step on the same input, so a sport remembers it (`memoFold`).
   */
  fold(input: SportFoldInput): SportFold<S>;
  /** The event a tap is, on the display it was made on; null for a tap that names what the match does not have. */
  eventFor(tap: S['tap'], context: SportEventContext<S>): SportEvent | null;
  /** The payload a queued tap is sent with now, given the ledger (a tap's first send may drop what is stale). */
  payloadForSend(queued: QueuedEvent, ledger: readonly LedgerEvent[]): unknown;

  // A tap.
  /** The side a tap picks to serve first (the Start tap's), which the match keeps; null for every other tap. */
  tossOf(tap: S['tap']): PadSide | null;
  /** What a tap the fold does not take is refused with. */
  refusalFor(tap: S['tap']): PadRefusal;

  // The display.
  /** The Start screen shows: the match has not started, and who serves first may still be picked. */
  notStarted(display: S['display']): boolean;
  /** The match is decided (a ledger read then asks the bootstrap whether it was finalized). */
  decided(display: S['display']): boolean;
  /** An ending waits to be recorded (Undo's `only: 'sanction'` takes back nothing else). */
  awaitingEnding(display: S['display']): boolean;
  /** What the last tap was, as Undo names it once it is taken back; null when it is nothing Undo names. */
  undoneOf(display: S['display']): S['undone'] | null;
  /** The display with its last tap said as `undone`, taken back. */
  showUndone(display: S['display'], undone: S['undone']): S['display'];
  /** The pad the kit draws for the display; `sync` is the transport's word, not the match's. */
  pad(display: S['display'], sync: PadSync): PadView<S['padKey']>;
}

/** What a tap is made on: the match, and the display the scorer saw. */
export type SportEventContext<S extends SportTypes> = {
  readonly bootstrap: Bootstrap;
  readonly display: S['display'];
};

/** A sport not yet known to the code that holds it: a runner, before its match says which. */
export type AnySport = ScoringSport<SportTypes>;
