import type { PadRefusal } from '@/domain/scoring/padLine';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';
import type { PadHistoryGroup, PadSide, PadSync, PadView } from '@/domain/scoring/padView';
import type { QueuedEvent, TapReading } from '@/domain/scoring/queue';
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
  /**
   * The scorer's pending picks (S2-4 plan Task 3), which the sport reads into its display (cricket's crease and bowler
   * before a ball carries them). Absent: none, as for every sport that keeps no picks.
   */
  readonly picks?: PendingPicks;
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
  | {
      readonly kind: 'unfoldable';
      readonly reason: Unfoldable;
      /** Why, for the record and never for the screen: a code or an error's name, no message and no payload. */
      readonly detail?: string;
    };

/**
 * A tap as the event the server records. `base` is optional and a sport's to set: a count its payload was made at (table
 * tennis: the score's; football's clock taps: the ledger's tip), which the runtime keeps on the queued tap
 * (`QueuedEvent.base`) for the sport's `payloadForSend` to read. `reading` likewise: the phone's own clock reading
 * behind a stamp the payload carries instead (football: a sub that joined a stoppage), kept on the queued tap
 * (`QueuedEvent.reading`) and never sent.
 */
export type SportEvent = {
  readonly type: string;
  readonly payload: unknown;
  readonly base?: number;
  readonly reading?: TapReading;
};

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
  /**
   * The payload a queued tap is sent with now, given the ledger (a send may drop what is stale). `copied` is whether the
   * ledger holds the server's copy of the tap (the match's `copiesOf`): a tap sent before keeps what it was first sent
   * with only while it does, since the server matches a resend by its key and never its payload. `send` holds the
   * bootstrap the match holds (`SportSendContext`), for a sport that judges a payload against the match's own fold
   * (football's stamps, against its phase). What it returns is written back into the queue, and the runtime knows the
   * server's copy of a tap by its payload: a payload must never change between two sends made over the same ledger. Or it
   * answers a `withdrawal`: the tap is not sent at all (`SendWithdrawal`).
   */
  payloadForSend(
    queued: QueuedEvent,
    ledger: readonly LedgerEvent[],
    copied: boolean,
    send: SportSendContext,
  ): unknown;

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
  /**
   * The games (sets, in another sport) over, as the sport writes them in one line, the first side's score first: what
   * Home's card calls a finished match ("21–15, 21–18"). Numbers and punctuation, never translated. Empty while none is
   * over; the match's own words ("Finished") are the dictionary's.
   */
  resultLine(display: S['display']): string;
  /** An ending waits to be recorded (the ending prompt's Undo, `only: 'ending'`, is taken only then). */
  awaitingEnding(display: S['display']): boolean;
  /** What the last tap was, as Undo names it once it is taken back; null when it is nothing Undo names. */
  undoneOf(display: S['display']): S['undone'] | null;
  /** The display with its last tap said as `undone`, taken back. */
  showUndone(display: S['display'], undone: S['undone']): S['display'];
  /** The pad the kit draws for the display; `sync` is the transport's word, not the match's. */
  pad(display: S['display'], sync: PadSync): PadView<S['padKey']>;
}

/**
 * What a send is judged with besides the ledger: the bootstrap the match holds, or null before one is, and the ids of the
 * events this phone sent (`ownEventIds`), which tell this phone's stand-ins (no link) from the organiser's console (no
 * link either, and not in the list).
 */
export type SportSendContext = {
  readonly bootstrap: Bootstrap | null;
  readonly ownEventIds: readonly string[];
};

/** A line a sport asks the record for: its event and fields, each key on the scrub's allow-list, never a person or an id. */
export type SportLine = {
  readonly event: string;
  readonly fields: Readonly<Record<string, string>>;
};

const WITHDRAWN: unique symbol = Symbol('withdrawn');

/**
 * What `payloadForSend` answers for a queued tap the sport takes back at its send: it is never sent, it leaves the
 * queue (an Undo that waits on it goes with it), and the record says `line`. Football's clock tap another screen
 * overtook is one (the controller's ruling, final review, 2026-11-08). No payload is a symbol, so none is mistaken for it.
 */
export type SendWithdrawal = { readonly withdrawn: typeof WITHDRAWN; readonly line: SportLine };

export const withdrawal = (line: SportLine): SendWithdrawal => ({ withdrawn: WITHDRAWN, line });

export const isWithdrawal = (answer: unknown): answer is SendWithdrawal =>
  typeof answer === 'object' &&
  answer !== null &&
  'withdrawn' in answer &&
  answer.withdrawn === WITHDRAWN;

/** What a tap is made on: the match, and the display the scorer saw. */
export type SportEventContext<S extends SportTypes> = {
  readonly bootstrap: Bootstrap;
  readonly display: S['display'];
};

/** A sport not yet known to the code that holds it: a runner, before its match says which. */
export type AnySport = ScoringSport<SportTypes>;
