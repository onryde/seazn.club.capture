import {
  SANCTION_LEVELS,
  type BadmintonDisplay,
  type BadmintonLastTap,
  type BadmintonPhase,
  type BadmintonSanction,
  type BadmintonSide,
  type BadmintonTap,
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
 * Every tap is an entry. The state is the entries replayed from the start, so Undo, which voids this phone's last
 * entry of its own, steps back through any rally, a game won included. Entries from someone else (`others`) are
 * replayed too and never voided (owner, 2026-10-31: one Undo, this phone's own taps).
 */
export type FakeBadmintonPad = {
  snapshot(): FakePadSnapshot;
  subscribe(listener: () => void): () => void;
  rally(side: PadSide): FakeOutcome;
  undo(): FakeOutcome;
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
};

/** Why a tap was not recorded: not at this point of the match, a score no game in progress has, nothing to undo. */
export type FakeRefusal = 'notNow' | 'invalidScore' | 'nothingToUndo';

export type FakeOutcome =
  { readonly ok: true } | { readonly ok: false; readonly refusal: FakeRefusal };

export type FakePadSample = {
  readonly sides: Readonly<Record<PadSide, BadmintonSide>>;
  /** Taps already on the sheet from someone else, in order. Undo never takes them back. */
  readonly others?: readonly BadmintonTap[];
};

export const SINGLES_SAMPLE: FakePadSample = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
};

/** Doubles, joined at 3-1 by a scorer before this phone: Undo stops at their taps. */
export const DOUBLES_SAMPLE: FakePadSample = {
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
  others: [
    { kind: 'rally', side: 'first' },
    { kind: 'rally', side: 'second' },
    { kind: 'rally', side: 'first' },
    { kind: 'rally', side: 'first' },
  ],
};

const GAME_POINT = 21;
const CAP = 30;
const BEST_OF = 3;
const INTERVAL_POINT = 11;

const OK: FakeOutcome = { ok: true };
const refused = (refusal: FakeRefusal): FakeOutcome => ({ ok: false, refusal });

type Entry = { readonly tap: BadmintonTap; readonly own: boolean; voided: boolean };

type Score = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly games: Readonly<Record<PadSide, number>>;
  readonly server: PadSide;
  readonly game: number;
  readonly phase: BadmintonPhase;
  readonly sanctions: readonly BadmintonSanction[];
  readonly lastTap: BadmintonLastTap | null;
  readonly awaitingEnding: boolean;
};

const START: Score = {
  points: { first: 0, second: 0 },
  games: { first: 0, second: 0 },
  server: 'first',
  game: 1,
  phase: 'pre',
  sanctions: [],
  lastTap: null,
  awaitingEnding: false,
};

const other = (side: PadSide): PadSide => (side === 'first' ? 'second' : 'first');

/** A side with `mine` against `theirs` has won the game. */
const wonGame = (mine: number, theirs: number) =>
  (mine >= GAME_POINT && mine - theirs >= 2) || mine >= CAP;

const isPoints = (value: number) => Number.isInteger(value) && value >= 0 && value <= CAP;

/** A score a game in progress can have: whole points to the cap, and neither side has won. */
const inProgress = (first: number, second: number) =>
  isPoints(first) && isPoints(second) && !wonGame(first, second) && !wonGame(second, first);

export function createFakeBadmintonPad(sample: FakePadSample): FakeBadmintonPad {
  const entries: Entry[] = (sample.others ?? []).map((tap) => ({ tap, own: false, voided: false }));
  const listeners = new Set<() => void>();
  let score = replay(entries);
  let undone: BadmintonTap | null = null;
  let card: PadStateCard | null = null;
  let sync: PadSync = { kind: 'synced' };
  let current = snapshotOf();

  function snapshotOf(): FakePadSnapshot {
    return { display: displayOf(sample, score, entries, undone), card, sync };
  }
  function changed(): void {
    score = replay(entries);
    current = snapshotOf();
    for (const listener of listeners) listener();
  }
  function record(tap: BadmintonTap): FakeOutcome {
    entries.push({ tap, own: true, voided: false });
    undone = null;
    changed();
    return OK;
  }
  function voidLastOwn(): FakeOutcome {
    const last = entries.filter((entry) => entry.own && !entry.voided).pop();
    if (last === undefined) return refused('nothingToUndo');
    last.voided = true;
    undone = last.tap;
    changed();
    return OK;
  }

  const playing = () => score.phase !== 'decided' && !score.awaitingEnding;
  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rally: (side) => (playing() ? record({ kind: 'rally', side }) : refused('notNow')),
    undo: voidLastOwn,
    sanction: (sanction) =>
      playing() && plays(sample, sanction)
        ? record({ kind: 'sanction', ...sanction })
        : refused('notNow'),
    setScore: (first, second) => {
      const between = score.phase === 'pre' || score.phase === 'betweenGames';
      if (!between || score.awaitingEnding) return refused('notNow');
      return inProgress(first, second)
        ? record({ kind: 'setScore', first, second })
        : refused('invalidScore');
    },
    recordEnding: () => {
      const pending = score.awaitingEnding
        ? score.sanctions[score.sanctions.length - 1]
        : undefined;
      if (pending === undefined) return refused('notNow');
      return record({ kind: 'ending', side: pending.side, person: pending.person });
    },
    voidSanction: () => (score.awaitingEnding ? voidLastOwn() : refused('notNow')),
    preview: (next) => {
      card = next;
      current = snapshotOf();
      for (const listener of listeners) listener();
    },
    setSync: (next) => {
      sync = next;
      current = snapshotOf();
      for (const listener of listeners) listener();
    },
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
    case 'ending':
      return { ...score, phase: 'decided', awaitingEnding: false, lastTap: tap };
  }
}

/** A point to `side`, which serves next; a game won resets the points, and the match is decided at two games. */
function rally(score: Score, side: PadSide): Score {
  const points = { ...score.points, [side]: score.points[side] + 1 };
  if (!wonGame(points[side], points[other(side)])) {
    return {
      ...score,
      points,
      server: side,
      phase: 'live',
      lastTap: { kind: 'rally', side, won: 'none', game: score.game },
    };
  }
  const games = { ...score.games, [side]: score.games[side] + 1 };
  if (games[side] > BEST_OF / 2) {
    const lastTap: BadmintonLastTap = { kind: 'rally', side, won: 'match', game: score.game };
    return { ...score, points, games, server: side, phase: 'decided', lastTap };
  }
  return {
    ...score,
    points: { first: 0, second: 0 },
    games,
    server: side,
    game: score.game + 1,
    phase: 'betweenGames',
    lastTap: { kind: 'rally', side, won: 'game', game: score.game },
  };
}

function displayOf(
  sample: FakePadSample,
  score: Score,
  entries: readonly Entry[],
  undone: BadmintonTap | null,
): BadmintonDisplay {
  return {
    sides: sample.sides,
    points: score.points,
    games: score.games,
    server: score.server,
    court: score.points[score.server] % 2 === 0 ? 'right' : 'left',
    game: score.game,
    bestOf: BEST_OF,
    intervalPoint: INTERVAL_POINT,
    phase: score.phase,
    sanctions: score.sanctions,
    lastTap: undone === null ? score.lastTap : { kind: 'undone', tap: undone },
    undoable: entries.some((entry) => entry.own && !entry.voided),
    awaitingEnding: score.awaitingEnding,
  };
}
