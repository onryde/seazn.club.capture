import { foldEpochOf } from '@seazn/engine/sport';
import type { ChessDisplay, ChessTiebreakState } from '@/domain/scoring/chessTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal chess ledgers for the fold's tests (plan S2-3 Task 1), `tableTennisLedger`'s twin: a bootstrap as the endpoint
 * sends it, and events written the way the web's ledger holds them. Only the inputs are built here; every expected
 * display is written out in the test that asserts it, from the FIDE laws and the design, never computed by the fold.
 */

export const HOME = 'ent-home';
export const AWAY = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

/** A side: one individual entrant with its one player. */
function seat(entrantId: string, personId: string, fullName: string): BootstrapSide {
  return {
    entrantId,
    name: fullName,
    kind: 'individual',
    members: [{ personId, fullName }],
    lineup: [{ personId, pairOrder: null }],
  };
}

/**
 * A team or pair entrant: its name is the organiser's (a club, a pairing), which is not any member's, and `members` are the
 * people who play for it.
 */
export function groupSide(
  entrantId: string,
  name: string,
  kind: 'team' | 'pair',
  members: readonly { readonly personId: string; readonly fullName: string }[],
): BootstrapSide {
  return {
    entrantId,
    name,
    kind,
    members,
    lineup: members.map(({ personId }) => ({ personId, pairOrder: null })),
  };
}

export const GAME: Bootstrap = {
  fixtureId: 'fx-chess-1',
  linkId: PHONE_LINK,
  sportKey: 'boardgame',
  moduleVersion: '1.0.0',
  cfg: {},
  rulesVersion: 1,
  epochRequired: foldEpochOf('boardgame'),
  screen: 'pad',
  viewOnlyReason: null,
  context: {
    competition: 'Spring Open 2026',
    division: 'Open Rapid',
    round: 'Round 1',
    match: 'Board 4',
  },
  sides: {
    home: seat(HOME, 'p-sharma', 'A. Sharma'),
    away: seat(AWAY, 'p-chen', 'L. Chen'),
  },
  lastSeq: 0,
  status: 'in_play',
};

/** The same game with its config set (a bracket stage's tie-break, or a division that plays without colours). */
export const withCfg = (bootstrap: Bootstrap, cfg: unknown): Bootstrap => ({ ...bootstrap, cfg });

/** A bracket stage: a drawn game waits for a tie-break (`cfg.tiebreak`), and the stage lists no rungs, so every rung is played. */
export const BRACKET: Bootstrap = withCfg(GAME, { tiebreak: true });

/**
 * A bracket stage that lists its tie-break rungs, in the order the stage plays them (the bootstrap's cfg is the stage's
 * resolved one). An empty list is the organiser's "no tie-break games": a drawn game folds level and is held for them.
 */
export const bracketWith = (rungs: readonly string[]): Bootstrap =>
  withCfg(GAME, { tiebreak: true, tiebreakRungs: rungs });

/** A division that plays without colours. */
export const NO_COLOURS: Bootstrap = withCfg(GAME, { colors: false });

/** An event before it is numbered: what was recorded, and by which link (another device's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  readonly voids?: number;
  readonly link?: string | null;
};

export type Seat = 'H' | 'A';
const entrant = (side: Seat) => (side === 'H' ? HOME : AWAY);

export const start = (): Spec => ({ type: 'core.start', payload: {} });

/** The game's result: the seat that won it (null: a draw), and how, if said. */
export const result = (winner: Seat | null, method?: string): Spec => ({
  type: 'boardgame.result',
  payload: {
    winner: winner === null ? null : entrant(winner),
    ...(method === undefined ? {} : { method }),
  },
});

/** The arbiter's pairing card: the seat that holds White. */
export const pairing = (white: Seat): Spec => ({
  type: 'boardgame.pairing',
  payload: { white: entrant(white) },
});

/** The organiser's walkover: the seat that did not turn up (`by`), recorded as a forfeit. */
export const forfeit = (by: Seat): Spec => ({
  type: 'core.forfeit',
  payload: { by: entrant(by), reason: 'walkover' },
});

/** A rapid tie-break after a drawn bracket game, with no score: the seat that advances. */
export const tiebreak = (winner: Seat): Spec => ({
  type: 'boardgame.tiebreak',
  payload: { rung: 'rapid', winner: entrant(winner) },
});

/** A rapid or blitz tie-break as the web's ledger holds it: the seat that advances, and the mini-match score if one was said. */
export const tiebreakRung = (rung: 'rapid' | 'blitz', winner: Seat, score?: string): Spec => ({
  type: 'boardgame.tiebreak',
  payload: {
    rung,
    winner: entrant(winner),
    ...(score === undefined ? {} : { score }),
  },
});

/** An Armageddon: who had Black and how it ended from White's side. The winner is never named (BG-KO-2). */
export const armageddon = (black: Seat, outcome: 'white' | 'black' | 'draw'): Spec => ({
  type: 'boardgame.tiebreak',
  payload: { rung: 'armageddon', black: entrant(black), result: outcome },
});

/** The organiser's settle of a level game (a drawn bracket game's lots, say): the seat that advances. */
export const settle = (
  winner: Seat,
  method: 'lot' | 'higher_seed' | 'organiser' = 'lot',
): Spec => ({
  type: 'core.settle',
  payload: { winner: entrant(winner), method },
});

/** The organiser locks the result. */
export const finalize = (): Spec => ({ type: 'core.finalize', payload: {} });

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

export const eventId = (seq: number) => `ev-${seq}`;

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-04T10:00:00.000Z';

/** The specs numbered from seq 1, as the server's ledger holds them, a second apart from `from` on. */
export function ledgerOf(specs: readonly Spec[], from: string = LEDGER_FROM): LedgerEvent[] {
  return specs.map((spec, i) => ({
    id: eventId(i + 1),
    seq: i + 1,
    type: spec.type,
    payload: spec.payload,
    recordedAt: new Date(Date.parse(from) + (i + 1) * 1000).toISOString(),
    voids: spec.voids === undefined ? null : eventId(spec.voids),
    deviceLinkId: spec.link === undefined ? BROWSER_LINK : spec.link,
  }));
}

/** A tap this phone queued, as the queue file holds it. */
export function queuedOf(key: string, spec: Spec): QueuedEvent {
  const payload = spec.voids === undefined ? spec.payload : { event_id: eventId(spec.voids) };
  return {
    key,
    type: spec.type,
    payload,
    rulesVersion: 1,
    createdAt: '2026-11-04T10:30:00.000Z',
    attempts: 0,
  };
}

/** No tie-break anywhere: not a bracket stage (nothing listed), nothing owed, nothing held, nothing decided. */
export const NO_TIEBREAK: ChessTiebreakState = {
  rungs: [],
  pending: false,
  held: false,
  decided: null,
};

/** A drawn bracket game waiting for the scorer's tie-break, the stage listing `rungs` (all three unless said). */
export const pendingTiebreak = (
  rungs: ChessTiebreakState['rungs'] = ['rapid', 'blitz', 'armageddon'],
): ChessTiebreakState => ({ rungs, pending: true, held: false, decided: null });

/**
 * A chess display written by hand, for the tests of what is built from one (the events a tap makes, the pad): a live game,
 * home holding White, nothing recorded. `over` says what a test changes.
 */
export const chessDisplay = (over: Partial<ChessDisplay> = {}): ChessDisplay => ({
  phase: 'live',
  colorOfHome: 'W',
  names: { first: 'A. Sharma', second: 'L. Chen' },
  result: null,
  context: { ...GAME.context, sides: ['A. Sharma', 'L. Chen'] },
  lastTap: null,
  undoable: false,
  tiebreak: NO_TIEBREAK,
  ...over,
});
