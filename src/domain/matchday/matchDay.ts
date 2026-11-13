/**
 * Match Day's day, as the phone holds it (S4 Match Day design §5, §7): what `parseDay` reads from the web's day read
 * (capture-matchday-day.v1, the web's `MatchDayCodeView`), in camelCase, with Dates, and the list model the screen
 * draws from it. The phone works nothing out: the courts' order and states, the queues and the approvals are the
 * server's (decision record ruling 14).
 */

/** A match's place in its day: not started, in play, or over (decided, finalized, held, abandoned, forfeited or cancelled). */
export type RowStatus = 'upcoming' | 'inPlay' | 'finished';

/** One piece of a row's names: a seat's words or the template's own, `dim` for a seat with no entrant yet. */
export type NamePart = { readonly text: string; readonly dim: boolean };

/** One match as the list shows it. */
export type Row = {
  readonly fixtureId: string;
  /** Decides which pad opens. */
  readonly sportKey: string;
  readonly divisionName: string;
  /** As the web's board codes it (R2, QF, SF, F, …), or null. */
  readonly roundLabel: string | null;
  /**
   * The web desk's own tag for the match (R1, SF·1, SF·2, F), English; null from a web that does not send it.
   * The row's chip says it, and falls back to `roundLabel`.
   */
  readonly roundTag: string | null;
  /** A seat with no entrant yet is null, never a made-up name. */
  readonly home: string | null;
  readonly away: string | null;
  /**
   * What the web desk prints for an empty seat ("Winner of Group A"), English; null when the seat has an entrant, the
   * web has no words for it, or it does not send them.
   */
  readonly homeSlot: string | null;
  readonly awaySlot: string | null;
  readonly status: RowStatus;
  readonly scheduledAt: Date | null;
  /** The short score while it plays, or the result once finished; null before any. */
  readonly summary: string | null;
};

/** Playing or called (one of the competition's matches is on it), free, or held by another competition. */
export type CourtState = 'playing' | 'called' | 'free' | 'inUseElsewhere';

/** A court (or table, or board) in the code's scope, as the server lists it. */
export type Court = {
  readonly courtId: string;
  readonly courtName: string;
  readonly venueName: string;
  readonly state: CourtState;
  readonly now: Row | null;
  /** The court's queue, in planned order. */
  readonly next: readonly Row[];
  /** Today's finished matches on it, newest first. */
  readonly finished: readonly Row[];
};

export type ScopeKind = 'competition' | 'venue' | 'courts';

/** A Swiss stage's next round, or the seed proposal from groups into a knockout (the draw). */
export type ApprovalKind = 'swiss' | 'draw';

export type Approval = {
  readonly kind: ApprovalKind;
  readonly stageId: string;
  readonly divisionName: string;
  /** The stage's name. */
  readonly label: string;
  /** Swiss: the round awaiting pairing ("Round 4 pairings are ready"); a draw: null. */
  readonly round: number | null;
  /**
   * A draw the web cannot seed yet: its groups are all decided but the stage is not complete. Waiting is for the web
   * desk to finish, so the phone offers no Review for it; null for a ready draw, a Swiss round and a web that does not say.
   */
  readonly waiting: 'stageComplete' | null;
};

export type MatchDay = {
  readonly competition: { readonly id: string; readonly name: string };
  /** `label` is what the header shows: the competition's, the venue's or the courts' names. */
  readonly scope: { readonly kind: ScopeKind; readonly label: string };
  /** The code's day, YYYY-MM-DD, in `tz`: a calendar day, not an instant. */
  readonly day: string;
  readonly tz: string;
  /** Before it the code answers MD_NOT_OPEN; from `expiresAt` it answers MD_ENDED. */
  readonly opensAt: Date;
  readonly expiresAt: Date;
  /** Minted with "can approve draws". */
  readonly canApprove: boolean;
  readonly courts: readonly Court[];
  /** A whole-competition code only: the day's matches on no court. */
  readonly noCourt: readonly Row[];
  /** Online chess boards: read-only. */
  readonly online: readonly Row[];
  /** Waiting in the code's scope, listed whether or not it can approve. */
  readonly approvals: readonly Approval[];
};

/** Every refusal word the md_ routes answer, the contracts' closed list (`$defs.refusal.code`). */
export const MATCHDAY_REFUSALS = [
  'MD_UNKNOWN',
  'MD_WITHDRAWN',
  'MD_ENDED',
  'MD_NOT_OPEN',
  'MD_OUT_OF_SCOPE',
  'MD_NO_APPROVE',
  'MD_STALE',
  'MD_ALREADY',
  'MD_TIES',
] as const;

export type MatchDayRefusal = (typeof MATCHDAY_REFUSALS)[number];

/** One court's card: Now, the first two of its queue as Next and Then, and its finished matches below them. */
export type CourtCard = {
  readonly courtId: string;
  readonly name: string;
  readonly venueName: string;
  readonly state: CourtState;
  readonly now: Row | null;
  readonly next: Row | null;
  readonly then: Row | null;
  readonly finished: readonly Row[];
};

/** The banner over the list: the first approval waiting. Without `canApprove` it has no button (`matchday.approve.webOnly`). */
export type Banner = { readonly approval: Approval; readonly canApprove: boolean };

/**
 * Whether the banner offers Review (S4 design §7): a code that can approve, and a stage the phone can name a round
 * for. A Swiss stage with no round, or a round of 1 (no round before it to call complete), is the web desk's, and so is
 * a draw the web still holds as waiting for its stage to complete (task 8d-B): there is no proposal to review yet.
 */
export function canReview({ approval, canApprove }: Banner): boolean {
  if (!canApprove || approval.waiting !== null) return false;
  return approval.kind === 'draw' || (approval.round !== null && approval.round > 1);
}

/** One card per court, in the server's order. Only the first two of a queue are shown. */
export function courtCards(day: MatchDay): readonly CourtCard[] {
  return day.courts.map(cardOf);
}

function cardOf(court: Court): CourtCard {
  return {
    courtId: court.courtId,
    name: court.courtName,
    venueName: court.venueName,
    state: court.state,
    now: court.now,
    next: court.next[0] ?? null,
    then: court.next[1] ?? null,
    finished: court.finished,
  };
}

/** The first approval the server lists, or null when none waits. */
export function bannerFor(day: MatchDay): Banner | null {
  const approval = day.approvals[0];
  return approval === undefined ? null : { approval, canApprove: day.canApprove };
}

/**
 * The venue chips (S4 design §5): only on a code scoped to the whole competition whose courts are in two venues or
 * more. Each venue once, in the order its first court comes; none otherwise.
 */
export function venuesOf(day: MatchDay): readonly string[] {
  if (day.scope.kind !== 'competition') return [];
  const venues = [...new Set(day.courts.map((court) => court.venueName))];
  return venues.length > 1 ? venues : [];
}

/** The cards a venue chip leaves, in the server's order: all of them with no venue picked, or one no longer the day's. */
export function courtCardsAt(day: MatchDay, venue: string | null): readonly CourtCard[] {
  const cards = courtCards(day);
  if (venue === null || !venuesOf(day).includes(venue)) return cards;
  return cards.filter((card) => card.venueName === venue);
}

/**
 * The unsent taps of a set of matches (S4 design §5 "Sending N"): how many wait, and whether a queue among them could
 * not be read, so its taps are at risk and no count can be said for it (`atStake`'s null).
 */
export type Stake = { readonly count: number; readonly unreadable: boolean };

/**
 * The stake of the matches `fixtureIds` names. `unsent` is a count per match opened from Match Day, null for a queue the
 * phone cannot read; a match it does not name has nothing waiting.
 */
export function stakeOf(
  fixtureIds: Iterable<string>,
  unsent: ReadonlyMap<string, number | null>,
): Stake {
  const held = [...fixtureIds].map((id) => unsent.get(id));
  return {
    count: held.reduce<number>((sum, one) => sum + (one ?? 0), 0),
    unreadable: held.includes(null),
  };
}

/** Each court's stake, from the matches on it only (now, its whole queue and its finished ones), keyed by court. */
export function sendingByCourt(
  day: MatchDay,
  unsent: ReadonlyMap<string, number | null>,
): ReadonlyMap<string, Stake> {
  return new Map(day.courts.map((court) => [court.courtId, stakeOf(idsOn(court), unsent)]));
}

function idsOn(court: Court): readonly string[] {
  const rows = [...(court.now === null ? [] : [court.now]), ...court.next, ...court.finished];
  return rows.map((row) => row.fixtureId);
}

/** The stake of the matches on no court yet (review M2): they are opened and scored as a court's are. */
export function noCourtStake(day: MatchDay, unsent: ReadonlyMap<string, number | null>): Stake {
  return stakeOf(
    day.noCourt.map((row) => row.fixtureId),
    unsent,
  );
}

/** Everything at stake on Exit (Task 7): every match opened from Match Day, on today's list or not. */
export function totalStake(unsent: ReadonlyMap<string, number | null>): Stake {
  return stakeOf(unsent.keys(), unsent);
}

/**
 * The chip a row starts with: the web desk's tag (SF·1), else the board's round label, else none (task 8d-B, F-T8-3).
 */
export function roundChipOf(row: Row): string | null {
  return row.roundTag ?? row.roundLabel;
}

/**
 * Both seats have an entrant. A match with an empty seat has no sides to score yet, so the list never opens it: a slot
 * label ("Winner of SF·1") says what the seat waits for, and is not an entrant.
 */
export function seated(row: Row): boolean {
  return row.home !== null && row.away !== null;
}

/** What a row shows at its right: a match not started, its planned time; in play or over, its score. */
export type RowDetail =
  | { readonly kind: 'time'; readonly at: Date }
  | { readonly kind: 'score'; readonly text: string }
  | null;

export function rowDetail(row: Row): RowDetail {
  if (row.status === 'upcoming')
    return row.scheduledAt === null ? null : { kind: 'time', at: row.scheduledAt };
  return row.summary === null ? null : { kind: 'score', text: row.summary };
}

/** The code's calendar day (`YYYY-MM-DD`) at noon UTC: said in UTC, it is that day whatever the phone's zone. */
export function noonOf(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** Nothing in the code's scope today: no court, no match without one and no online board. */
export function isEmptyDay(day: MatchDay): boolean {
  return day.courts.length === 0 && day.noCourt.length === 0 && day.online.length === 0;
}
