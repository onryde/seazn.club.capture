import type { BadmintonHistoryEntry } from '@/domain/scoring/badmintonHistory';
import type { BadmintonRules } from '@/domain/scoring/badmintonRules';
import type { MatchContext } from '@/domain/scoring/matchContext';
import {
  SANCTION_LEVELS,
  sideNames,
  type BadmintonDisplay,
  type BadmintonDone,
  type BadmintonGame,
  type BadmintonPhase,
  type BadmintonSanction,
  type BadmintonSide,
  type BadmintonTap,
  type BadmintonUndoneTap,
} from '@/domain/scoring/badmintonPad';
import type { PadSide, PadStateCard, PadSync } from '@/domain/scoring/padView';

/**
 * A FAKE badminton pad, for the S2 design preview and nothing else: the owner holds the pad on a phone before signing
 * off the design (2026-10-31), with no engine and no network. It is NOT scoring rules for production. It keeps simple
 * counters: a game to 21, won by 2, capped at 30; best of 3; the server is the last rally's winner, so a game's
 * winner serves the next; the service court is the right on the server's even score, the left on its odd one; the
 * interval point is 11. Sanctions change no score. The rules belong to the engine, which S2's real scoring client
 * reads; nothing outside the preview may call this.
 *
 * A match begins not started: Start, with the side picked to serve first, is its first entry (owner, 2026-11-01, option
 * A). Every tap is an entry. The state is the entries replayed from the start, so Undo, which voids this phone's last
 * entry of its own, steps back through any rally, a game won included. The start is undone only while nothing follows
 * it, as on the web, where a start cannot be voided once anything follows. Entries from someone else (`others`) are
 * replayed too and never voided (owner, 2026-10-31: one Undo, this phone's own taps). Each entry keeps what it did when
 * it was recorded, for History (owner ruling 21), which lists a voided entry in its place.
 */
export type FakeBadmintonPad = {
  snapshot(): FakePadSnapshot;
  subscribe(listener: () => void): () => void;
  rally(side: PadSide): FakeOutcome;
  undo(): FakeOutcome;
  /**
   * Before the match only: starts it, `server` serving first from the right court at 0-0. S2's real write of the first
   * server (the engine kernel accepts a declared server) is still to be confirmed against the engine (2026-11-01).
   */
  start(server: PadSide): FakeOutcome;
  sanction(sanction: BadmintonSanction): FakeOutcome;
  /** Before a game's first rally only: the match's first, or the next game's. */
  setScore(first: number, second: number): FakeOutcome;
  /** After a disqualification: the match ends, the other side wins. */
  recordEnding(): FakeOutcome;
  /** After a disqualification: the sanction is voided, and play goes on as before it. */
  voidSanction(): FakeOutcome;
  /** The dev row's state card, drawn over the same match; null shows the pad. */
  preview(card: PadStateCard | null): void;
  /** The dev row's sync status. */
  setSync(sync: PadSync): void;
};

export type FakePadSnapshot = {
  readonly display: BadmintonDisplay;
  readonly card: PadStateCard | null;
  readonly sync: PadSync;
  /** Every entry, oldest first, voided ones in their place (History, owner ruling 21). */
  readonly history: readonly BadmintonHistoryEntry[];
};

/** Why a tap was not recorded: not at this point of the match, a score no game in progress has, nothing to undo. */
export type FakeRefusal = 'notNow' | 'invalidScore' | 'nothingToUndo';

export type FakeOutcome =
  { readonly ok: true } | { readonly ok: false; readonly refusal: FakeRefusal };

export type FakePadSample = {
  readonly sides: Readonly<Record<PadSide, BadmintonSide>>;
  /** Where the match sits; its sides are the players above, joined as the match label joins them. Made up. */
  readonly context: Omit<MatchContext, 'sides'>;
  /** Taps already on the sheet from someone else, in order. Undo never takes them back. */
  readonly others?: readonly BadmintonTap[];
};

export const SINGLES_SAMPLE: FakePadSample = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round: 'Round 1',
    match: 'Match 4',
  },
};

/**
 * Doubles, started and joined at 3-1 by a scorer before this phone: Undo stops at their taps, and History says "Another
 * scorer". The preview row's Start begins it afresh, with none of their taps.
 */
export const DOUBLES_SAMPLE: FakePadSample = {
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
  context: {
    competition: 'Riverside Badminton Club Championships 2026',
    division: 'Open Mixed Doubles',
    round: 'Quarter-final',
    match: 'BAD0001',
  },
  others: [
    { kind: 'start', server: 'first' },
    { kind: 'rally', side: 'first' },
    { kind: 'rally', side: 'second' },
    { kind: 'rally', side: 'first' },
    { kind: 'rally', side: 'first' },
  ],
};

/** The preview match's config, which the pad's strip and its Match details read (`BadmintonDisplay.rules`). */
const RULES = {
  bestOf: 3,
  points: 21,
  decidingPoints: 21,
  winBy: 2,
  cap: 30,
  intervalPoint: 11,
  decidingIntervalPoint: 11,
} satisfies BadmintonRules;

const OK: FakeOutcome = { ok: true };
const refused = (refusal: FakeRefusal): FakeOutcome => ({ ok: false, refusal });

/** A tap on the sheet, with what it did when it was recorded (History keeps it after Undo voids the entry). */
type Entry = {
  readonly tap: BadmintonTap;
  readonly own: boolean;
  voided: boolean;
  readonly did: BadmintonDone;
  readonly game: number;
  readonly after: Readonly<Record<PadSide, number>>;
};

type Score = {
  readonly points: Readonly<Record<PadSide, number>>;
  /** The games won on a rally, in order: replayed like the rest, so an Undo that reopens one takes it away. */
  readonly finished: readonly BadmintonGame[];
  readonly server: PadSide;
  readonly game: number;
  readonly phase: BadmintonPhase;
  readonly sanctions: readonly BadmintonSanction[];
  readonly lastTap: BadmintonDone | null;
  readonly awaitingEnding: boolean;
};

const START: Score = {
  points: { first: 0, second: 0 },
  finished: [],
  server: 'first',
  game: 1,
  phase: 'notStarted',
  sanctions: [],
  lastTap: null,
  awaitingEnding: false,
};

const other = (side: PadSide): PadSide => (side === 'first' ? 'second' : 'first');

/** A side with `mine` against `theirs` has won the game. */
const wonGame = (mine: number, theirs: number) =>
  (mine >= RULES.points && mine - theirs >= RULES.winBy) || mine >= RULES.cap;

const isPoints = (value: number) => Number.isInteger(value) && value >= 0 && value <= RULES.cap;

/** A score a game in progress can have: whole points to the cap, and neither side has won. */
const inProgress = (first: number, second: number) =>
  isPoints(first) && isPoints(second) && !wonGame(first, second) && !wonGame(second, first);

/** The fake's state: every entry, what Undo last took back, the score they replay to, and the preview's card and sync. */
type Ledger = {
  readonly entries: Entry[];
  score: Score;
  undone: BadmintonUndoneTap | null;
  card: PadStateCard | null;
  sync: PadSync;
};

type Commands = Pick<
  FakeBadmintonPad,
  'start' | 'rally' | 'undo' | 'sanction' | 'setScore' | 'recordEnding' | 'voidSanction'
>;

export function createFakeBadmintonPad(sample: FakePadSample): FakeBadmintonPad {
  const entries = othersOf(sample.others ?? []);
  const ledger: Ledger = {
    entries,
    score: replay(entries),
    undone: null,
    card: null,
    sync: SYNCED,
  };
  const listeners = new Set<() => void>();
  let current = snapshotOf(sample, ledger);
  const publish = () => {
    ledger.score = replay(ledger.entries);
    current = snapshotOf(sample, ledger);
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...commands(sample, ledger, publish),
    preview: (next) => {
      ledger.card = next;
      publish();
    },
    setSync: (next) => {
      ledger.sync = next;
      publish();
    },
  };
}

const SYNCED: PadSync = { kind: 'synced' };

/** Someone else's taps, each recorded on the match their predecessors made. */
function othersOf(taps: readonly BadmintonTap[]): Entry[] {
  const entries: Entry[] = [];
  for (const tap of taps) entries.push(entryOf(replay(entries), tap, false));
  return entries;
}

/** An entry for `tap` on the match at `score`: what it did, the game it was in and the points after it, kept as recorded. */
function entryOf(score: Score, tap: BadmintonTap, own: boolean): Entry {
  return {
    tap,
    own,
    voided: false,
    did: didOf(score, tap),
    game: score.game,
    after: afterOf(score, tap),
  };
}

function didOf(score: Score, tap: BadmintonTap): BadmintonDone {
  if (tap.kind !== 'rally') return tap;
  return { kind: 'rally', side: tap.side, won: rallyWon(score, tap.side), game: score.game };
}

/** Each side's points after the tap: a rally's the game's final points when it wins the game. */
function afterOf(score: Score, tap: BadmintonTap): Readonly<Record<PadSide, number>> {
  if (tap.kind === 'rally') return { ...score.points, [tap.side]: score.points[tap.side] + 1 };
  return tap.kind === 'setScore' ? { first: tap.first, second: tap.second } : score.points;
}

/** The scorer's taps on the ledger: each records an entry, or is refused with nothing recorded. */
function commands(sample: FakePadSample, ledger: Ledger, publish: () => void): Commands {
  const record = (tap: BadmintonTap) => recordTap(ledger, publish, tap);
  const undo = () => voidLastOwn(ledger, publish);
  const playing = () =>
    ledger.score.phase !== 'notStarted' &&
    ledger.score.phase !== 'decided' &&
    !ledger.score.awaitingEnding;
  return {
    start: (server) =>
      ledger.score.phase === 'notStarted' ? record({ kind: 'start', server }) : refused('notNow'),
    rally: (side) => (playing() ? record({ kind: 'rally', side }) : refused('notNow')),
    undo,
    sanction: (sanction) =>
      playing() && plays(sample, sanction)
        ? record({ kind: 'sanction', ...sanction })
        : refused('notNow'),
    setScore: (first, second) => setScoreOn(ledger.score, record, first, second),
    recordEnding: () => endingOn(ledger.score, record),
    voidSanction: () => voidPending(ledger, publish),
  };
}

function recordTap(ledger: Ledger, publish: () => void, tap: BadmintonTap): FakeOutcome {
  ledger.entries.push(entryOf(ledger.score, tap, true));
  ledger.undone = null;
  publish();
  return OK;
}

/**
 * Undo: voids this phone's last entry still standing; someone else's are never voided. Undoing the start returns to
 * the Start screen, which has no line to say it on.
 */
function voidLastOwn(ledger: Ledger, publish: () => void): FakeOutcome {
  const last = voidable(ledger.entries);
  return last === undefined ? refused('nothingToUndo') : voidEntry(ledger, publish, last);
}

/**
 * Void: takes back the disqualification waiting for its ending, its own entry (nothing records while it waits, so it
 * is the last entry standing), and only when this phone recorded it (review M5, 2026-11-01). None waiting: refused.
 */
function voidPending(ledger: Ledger, publish: () => void): FakeOutcome {
  if (!ledger.score.awaitingEnding) return refused('notNow');
  const pending = ledger.entries.filter((entry) => !entry.voided).pop();
  if (pending === undefined || !pending.own) return refused('nothingToUndo');
  return voidEntry(ledger, publish, pending);
}

/** An entry taken back: it stays in place, voided, and the line says so (a start has no line to say it on). */
function voidEntry(ledger: Ledger, publish: () => void, entry: Entry): FakeOutcome {
  entry.voided = true;
  ledger.undone = entry.tap.kind === 'start' ? null : entry.tap;
  publish();
  return OK;
}

/**
 * The entry Undo would take back: this phone's last still standing, but a start only while nothing at all follows it,
 * an entry Undo took back included (the web voids no start once anything follows).
 */
function voidable(entries: readonly Entry[]): Entry | undefined {
  const last = entries.filter((entry) => entry.own && !entry.voided).pop();
  if (last?.tap.kind === 'start' && entries[entries.length - 1] !== last) return undefined;
  return last;
}

/** Before a game's first rally only, and only a score a game in progress can have. */
function setScoreOn(
  score: Score,
  record: (tap: BadmintonTap) => FakeOutcome,
  first: number,
  second: number,
): FakeOutcome {
  const between = score.phase === 'pre' || score.phase === 'betweenGames';
  if (!between || score.awaitingEnding) return refused('notNow');
  return inProgress(first, second)
    ? record({ kind: 'setScore', first, second })
    : refused('invalidScore');
}

/** A disqualification's ending: the match ends, the other side wins. Only while one waits. */
function endingOn(score: Score, record: (tap: BadmintonTap) => FakeOutcome): FakeOutcome {
  const pending = score.awaitingEnding ? score.sanctions[score.sanctions.length - 1] : undefined;
  if (pending === undefined) return refused('notNow');
  return record({ kind: 'ending', side: pending.side, person: pending.person });
}

function snapshotOf(sample: FakePadSample, ledger: Ledger): FakePadSnapshot {
  return {
    display: displayOf(sample, ledger.score, ledger.entries, ledger.undone),
    card: ledger.card,
    sync: ledger.sync,
    history: ledger.entries.map(({ did, game, after, own, voided }) => ({
      did,
      game,
      after,
      own,
      undone: voided,
      sending: false,
    })),
  };
}

/** The sanction names a level the pad knows, and a person who plays for that side. */
function plays(sample: FakePadSample, sanction: BadmintonSanction): boolean {
  return (
    SANCTION_LEVELS.includes(sanction.level) &&
    sample.sides[sanction.side].players.includes(sanction.person)
  );
}

function replay(entries: readonly Entry[]): Score {
  return entries
    .filter((entry) => !entry.voided)
    .reduce((score, entry) => apply(score, entry.tap), START);
}

function apply(score: Score, tap: BadmintonTap): Score {
  switch (tap.kind) {
    case 'start':
      return { ...score, server: tap.server, phase: 'pre', lastTap: tap };
    case 'rally':
      return rally(score, tap.side);
    case 'setScore':
      return { ...score, points: { first: tap.first, second: tap.second }, lastTap: tap };
    case 'sanction': {
      const sanction = { side: tap.side, level: tap.level, person: tap.person };
      return {
        ...score,
        sanctions: [...score.sanctions, sanction],
        lastTap: tap,
        awaitingEnding: tap.level === 'disqualification',
      };
    }
    case 'ending': {
      // The game in play ends with the match, at its points then, the side disqualified named (owner ruling 18).
      const stopped: BadmintonGame = { points: score.points, disqualified: tap.side };
      return {
        ...score,
        finished: [...score.finished, stopped],
        phase: 'decided',
        awaitingEnding: false,
        lastTap: tap,
      };
    }
  }
}

const wins = (finished: readonly BadmintonGame[], side: PadSide) =>
  finished.filter((game) => 'winner' in game && game.winner === side).length;

/** What a point to `side` wins: nothing, the game, or the match (two games of three). */
function rallyWon(score: Score, side: PadSide): 'none' | 'game' | 'match' {
  const points = { ...score.points, [side]: score.points[side] + 1 };
  if (!wonGame(points[side], points[other(side)])) return 'none';
  const finished = [...score.finished, { points, winner: side }];
  return wins(finished, side) > RULES.bestOf / 2 ? 'match' : 'game';
}

/**
 * A point to `side`, which serves next. A game won is kept with its final points and the next starts at 0-0; the match
 * is decided at two games, its last kept as the points too.
 */
function rally(score: Score, side: PadSide): Score {
  const points = { ...score.points, [side]: score.points[side] + 1 };
  const won = rallyWon(score, side);
  const lastTap: BadmintonDone = { kind: 'rally', side, won, game: score.game };
  if (won === 'none') return { ...score, points, server: side, phase: 'live', lastTap };
  const finished = [...score.finished, { points, winner: side }];
  if (won === 'match') {
    return { ...score, points, finished, server: side, phase: 'decided', lastTap };
  }
  return {
    ...score,
    points: { first: 0, second: 0 },
    finished,
    server: side,
    game: score.game + 1,
    phase: 'betweenGames',
    lastTap,
  };
}

function displayOf(
  sample: FakePadSample,
  score: Score,
  entries: readonly Entry[],
  undone: BadmintonUndoneTap | null,
): BadmintonDisplay {
  return {
    sides: sample.sides,
    context: {
      ...sample.context,
      sides: [sideNames(sample.sides.first), sideNames(sample.sides.second)],
    },
    points: score.points,
    finished: score.finished,
    server: score.server,
    court: score.points[score.server] % 2 === 0 ? 'right' : 'left',
    game: score.game,
    rules: RULES,
    phase: score.phase,
    sanctions: score.sanctions,
    lastTap: undone === null ? score.lastTap : { kind: 'undone', tap: undone },
    undoable: voidable(entries) !== undefined,
    awaitingEnding: score.awaitingEnding,
    // The preview keeps the score itself and knows who serves: nothing is ever this phone's pick to send.
    serverPicked: false,
  };
}
