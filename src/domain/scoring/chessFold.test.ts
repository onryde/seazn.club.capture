import { describe, expect, it } from 'vitest';
import { foldChess } from '@/domain/scoring/chessFold';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  BRACKET,
  GAME,
  NO_COLOURS,
  eventId,
  finalize,
  forfeit,
  ledgerOf,
  pairing,
  queuedOf,
  result,
  start,
  tiebreak,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/chessLedger';

// A chess game on the pad (spec §4, §5; plan S2-3 Task 1): the server's ledger with this phone's queued taps on top,
// folded through the engine's boardgame module. Every expected value is written out from the spec and FIDE's laws, never
// computed by the fold. Seat letters: H is home (the top name), A is away.

type Over = {
  readonly bootstrap?: Bootstrap;
  readonly queued?: readonly QueuedEvent[];
  readonly own?: readonly number[];
};

/** The fold of a ledger of `specs`; `own` lists the seqs this phone recorded. */
function foldOf(specs: readonly Spec[], over: Over = {}) {
  const input: SportFoldInput = {
    bootstrap: over.bootstrap ?? GAME,
    ledger: ledgerOf(specs),
    queued: over.queued ?? [],
    ownEventIds: (over.own ?? []).map(eventId),
    toss: null,
  };
  return foldChess(input);
}

function displayOf(specs: readonly Spec[], over: Over = {}) {
  const folded = foldOf(specs, over);
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

describe('foldChess: the phase', () => {
  it('is not started on an empty ledger, with home holding White and nothing recorded', () => {
    expect(displayOf([])).toEqual({
      phase: 'notStarted',
      colorOfHome: 'W',
      names: { first: 'A. Sharma', second: 'L. Chen' },
      result: null,
      context: {
        competition: 'Spring Open 2026',
        division: 'Open Rapid',
        round: 'Round 1',
        match: 'Board 4',
        sides: ['A. Sharma', 'L. Chen'],
      },
      lastTap: null,
      undoable: false,
    });
  });

  it('is live once the match starts', () => {
    const display = displayOf([start()]);
    expect(display.phase).toBe('live');
    expect(display.result).toBeNull();
    expect(display.lastTap).toEqual({ kind: 'start' });
  });

  it('is done when a result is recorded, and final once the organiser locks it', () => {
    expect(displayOf([start(), result('H')]).phase).toBe('done');
    expect(displayOf([start(), result('H'), finalize()]).phase).toBe('final');
  });

  it('is final for an abandoned game too: nothing more can be recorded, and no result stands', () => {
    const display = displayOf([start(), { type: 'core.abandon', payload: { reason: 'flooded' } }]);
    expect(display.phase).toBe('final');
    expect(display.result).toBeNull();
  });
});

describe('foldChess: the result is White, Black or a draw', () => {
  it('a home win is White’s win while home holds White', () => {
    expect(displayOf([start(), result('H')]).result).toEqual({
      outcome: 'white',
      method: null,
      own: false,
    });
  });

  it('an away win is Black’s win', () => {
    expect(displayOf([start(), result('A')]).result?.outcome).toBe('black');
  });

  it('after a pairing gave White to away, a home win is Black’s and an away win White’s', () => {
    expect(displayOf([start(), pairing('A'), result('H')]).result?.outcome).toBe('black');
    expect(displayOf([start(), pairing('A'), result('A')]).result?.outcome).toBe('white');
    expect(displayOf([start(), pairing('A')]).colorOfHome).toBe('B');
  });

  it('a pairing back to home restores White, and the last pairing is the one that stands', () => {
    const display = displayOf([start(), pairing('A'), pairing('H'), result('H')]);
    expect(display.colorOfHome).toBe('W');
    expect(display.result?.outcome).toBe('white');
  });

  it('a draw is a draw, with its method', () => {
    expect(displayOf([start(), result(null, 'agreement')]).result).toEqual({
      outcome: 'draw',
      method: 'agreement',
      own: false,
    });
  });

  it('keeps the method of a win', () => {
    expect(displayOf([start(), result('H', 'checkmate')]).result?.method).toBe('checkmate');
    expect(displayOf([start(), result('A', 'resign')]).result?.method).toBe('resign');
  });

  it('reads no method from a result recorded without one', () => {
    expect(displayOf([start(), result(null)]).result?.method).toBeNull();
  });

  it('shows the player’s names in the seats they were given, whoever holds White', () => {
    expect(displayOf([start(), pairing('A')]).names).toEqual({
      first: 'A. Sharma',
      second: 'L. Chen',
    });
  });
});

describe('foldChess: Undo', () => {
  it('a void of the result takes the game back to live, with no result', () => {
    const display = displayOf([start(), result('H'), voiding(2)]);
    expect(display.phase).toBe('live');
    expect(display.result).toBeNull();
  });

  it('a new result after the void stands as the result', () => {
    const display = displayOf([start(), result('H'), voiding(2), result('A', 'time')]);
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'black', method: 'time', own: false });
  });

  it('a void of the pairing puts the colours back', () => {
    expect(displayOf([start(), pairing('A'), voiding(2)]).colorOfHome).toBe('W');
  });
});

describe('foldChess: a drawn game in a bracket stage', () => {
  it('waits for the tie-break: the phase is tiebreak and no result stands', () => {
    const display = displayOf([start(), result(null, 'agreement')], { bootstrap: BRACKET });
    expect(display.phase).toBe('tiebreak');
    expect(display.result).toBeNull();
  });

  it('a decisive game in a bracket stage is done at once', () => {
    const display = displayOf([start(), result('H', 'checkmate')], { bootstrap: BRACKET });
    expect(display.phase).toBe('done');
    expect(display.result?.outcome).toBe('white');
  });

  it('the organiser’s tie-break decides who advances; the game itself stays a draw', () => {
    const display = displayOf([start(), result(null, 'agreement'), tiebreak('A')], {
      bootstrap: BRACKET,
    });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'draw', method: 'agreement', own: false });
  });

  it('a draw in a stage with no tie-break is done, not waiting', () => {
    expect(displayOf([start(), result(null)]).phase).toBe('done');
  });
});

describe('foldChess: what the organiser decides', () => {
  it('a walkover is done, and the player who turned up is the result’s winner, with no method', () => {
    const display = displayOf([forfeit('A')]);
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'white', method: null, own: false });
  });

  it('a double walkover is done with no result: nobody won and nobody drew', () => {
    const both: Spec = { type: 'core.forfeit', payload: { by: 'both', reason: 'walkover' } };
    const display = displayOf([both]);
    expect(display.phase).toBe('done');
    expect(display.result).toBeNull();
  });
});

describe('foldChess: whose result it is', () => {
  it('is not this phone’s when another device’s link recorded it', () => {
    expect(displayOf([start(), result('H')], { own: [1] }).result?.own).toBe(false);
  });

  it('is this phone’s only when its event ids hold the result', () => {
    expect(displayOf([start(), result('H')], { own: [1, 2] }).result?.own).toBe(true);
  });

  it('is this phone’s when the result is only queued', () => {
    const queued = [queuedOf('tap-1', result('A', 'resign'))];
    const display = displayOf([start()], { own: [1], queued });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'black', method: 'resign', own: true });
  });

  it('follows the result that stands: after an Undo and another scorer’s new result it is theirs', () => {
    const specs = [start(), result('H'), voiding(2), result('A')];
    expect(displayOf(specs, { own: [1, 2, 3] }).result?.own).toBe(false);
    expect(displayOf(specs, { own: [1, 2, 3, 4] }).result?.own).toBe(true);
  });
});

describe('foldChess: Undo is offered only for a result this phone can still take back', () => {
  it('is on for this phone’s own result with nothing after it', () => {
    expect(displayOf([start(), result('H')], { own: [1, 2] }).undoable).toBe(true);
  });

  it('is off for another scorer’s result', () => {
    expect(displayOf([start(), result('H')], { own: [1] }).undoable).toBe(false);
  });

  it('is off once the organiser has finalised', () => {
    expect(displayOf([start(), result('H'), finalize()], { own: [1, 2] }).undoable).toBe(false);
  });

  it('is on for this phone’s draw while the game waits for the tie-break', () => {
    const display = displayOf([start(), result(null)], { own: [1, 2], bootstrap: BRACKET });
    expect(display.phase).toBe('tiebreak');
    expect(display.undoable).toBe(true);
  });

  it('is off once the organiser has recorded the tie-break after it', () => {
    const specs = [start(), result(null), tiebreak('H')];
    expect(displayOf(specs, { own: [1, 2], bootstrap: BRACKET }).undoable).toBe(false);
  });

  it('is off before anything of this phone’s stands', () => {
    expect(displayOf([], { own: [] }).undoable).toBe(false);
    expect(displayOf([start()], { own: [] }).undoable).toBe(false);
  });

  it('is off for this phone’s own start or swap: Undo here takes back a result, nothing else', () => {
    expect(displayOf([start()], { own: [1] }).undoable).toBe(false);
    expect(displayOf([start(), pairing('A')], { own: [1, 2] }).undoable).toBe(false);
    const queuedStart = [queuedOf('tap-1', start())];
    expect(displayOf([], { queued: queuedStart }).undoable).toBe(false);
  });

  it('stays on for the standing result when a queued tap behind it is dropped: the pad never shows an illegal tap', () => {
    // A second result is refused by the engine (ALREADY_DECIDED), so it is skipped and the standing result is still the one
    // Undo would take back.
    const queued = [queuedOf('tap-1', result('A'))];
    expect(displayOf([start(), result('H')], { own: [1, 2], queued }).undoable).toBe(true);
  });

  it('is on for a result still queued', () => {
    const queued = [queuedOf('tap-1', result('H'))];
    expect(displayOf([start()], { own: [1], queued }).undoable).toBe(true);
  });
});

describe('foldChess: colours', () => {
  it('knows no colours when the division plays without them, a recorded pairing included', () => {
    expect(displayOf([], { bootstrap: NO_COLOURS }).colorOfHome).toBeNull();
    expect(displayOf([start(), pairing('A')], { bootstrap: NO_COLOURS }).colorOfHome).toBeNull();
  });

  it('still reports the winner of a game played without colours: the first name is the White win', () => {
    expect(displayOf([start(), result('H')], { bootstrap: NO_COLOURS }).result?.outcome).toBe(
      'white',
    );
    expect(displayOf([start(), result('A')], { bootstrap: NO_COLOURS }).result?.outcome).toBe(
      'black',
    );
  });

  it('a config that says colours are on is the default', () => {
    expect(displayOf([], { bootstrap: withCfg(GAME, { colors: true }) }).colorOfHome).toBe('W');
  });
});

describe('foldChess: what it cannot fold', () => {
  it('refuses a ledger the engine will not replay: a result before the start', () => {
    expect(foldOf([result('H')])).toEqual({ kind: 'unfoldable', reason: 'ledger' });
  });

  it('refuses a second result: the game is over', () => {
    expect(foldOf([start(), result('H'), result('A')])).toEqual({
      kind: 'unfoldable',
      reason: 'ledger',
    });
  });

  it('says sides when a seat has no entrant', () => {
    const bye = { ...GAME, sides: { home: GAME.sides.home, away: null } };
    expect(foldOf([], { bootstrap: bye })).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('says cfg when the engine’s schema refuses the config', () => {
    expect(foldOf([], { bootstrap: withCfg(GAME, { colors: 'sometimes' }) })).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });
});

describe('foldChess: which queued taps the game still takes', () => {
  const key = (n: number) => `tap-${n}`;
  const legalOf = (specs: readonly Spec[], queued: readonly Spec[], over: Over = {}) => {
    const taps = queued.map((spec, i) => queuedOf(key(i + 1), spec));
    const folded = foldOf(specs, { ...over, queued: taps });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    return folded.legalQueued;
  };

  it('takes a result queued after the start', () => {
    expect(legalOf([start()], [result('H')])).toEqual(['tap-1']);
  });

  it('takes a start, then a result queued behind it', () => {
    expect(legalOf([], [start(), result('A', 'resign')])).toEqual(['tap-1', 'tap-2']);
  });

  it('drops a result queued before the game has started', () => {
    expect(legalOf([], [result('H')])).toEqual([]);
  });

  it('drops a second result', () => {
    expect(legalOf([start()], [result('H'), result('A')])).toEqual(['tap-1']);
  });

  it('judges the taps behind a dropped one without it', () => {
    const queued = [pairing('A'), result('H')];
    expect(legalOf([start()], queued, { bootstrap: NO_COLOURS })).toEqual(['tap-2']);
  });

  it('drops a result another scorer has already recorded', () => {
    expect(legalOf([start(), result('A')], [result('H')])).toEqual([]);
  });

  it('drops a result whose method contradicts it, which the web refuses on write', () => {
    expect(legalOf([start()], [result(null, 'checkmate')])).toEqual([]);
    expect(legalOf([start()], [result('H', 'stalemate')])).toEqual([]);
  });

  it('drops a pairing in a division that plays without colours', () => {
    expect(legalOf([start()], [pairing('A')], { bootstrap: NO_COLOURS })).toEqual([]);
  });

  it('takes a pairing before the result and refuses one after it', () => {
    expect(legalOf([start()], [pairing('A')])).toEqual(['tap-1']);
    expect(legalOf([start(), result('H')], [pairing('A')])).toEqual([]);
  });

  it('takes a queued Undo of the result, and refuses a second Undo of the same event', () => {
    const undo = voiding(2);
    expect(legalOf([start(), result('H')], [undo], { own: [1, 2] })).toEqual(['tap-1']);
    expect(legalOf([start(), result('H')], [undo, undo], { own: [1, 2] })).toEqual(['tap-1']);
  });
});

describe('foldChess: the history', () => {
  it('lists what was recorded, newest first, with an undone result struck in its place', () => {
    const folded = foldOf([start(), pairing('A'), result('H', 'resign'), voiding(3)], {
      own: [1, 2, 3, 4],
    });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.history).toHaveLength(1);
    expect(folded.history[0]?.heading).toEqual({ key: 'scoring.chess.gameHeading' });
    expect(folded.history[0]?.rows.map((row) => [row.said.key, row.undone, row.by])).toEqual([
      ['scoring.chess.last.wonBy', true, 'thisPhone'],
      ['scoring.chess.last.swap', false, 'thisPhone'],
      ['scoring.chess.last.start', false, 'thisPhone'],
    ]);
  });

  it('says a result in the players’ names, as the organiser typed them, whoever holds White', () => {
    const folded = foldOf([start(), pairing('A'), result('A', 'resign')]);
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.history[0]?.rows[0]?.said).toEqual({
      key: 'scoring.chess.last.wonBy',
      vars: { name: 'L. Chen', how: { key: 'scoring.chess.method.resign' } },
    });
  });

  it('marks another scorer’s event as theirs and this phone’s queued tap as sending', () => {
    const queued = [queuedOf('tap-1', result('H'))];
    const folded = foldOf([start()], { queued });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    const rows = folded.history[0]?.rows ?? [];
    expect(rows.map((row) => [row.said.key, row.by, row.sending])).toEqual([
      ['scoring.chess.last.won', 'thisPhone', true],
      ['scoring.chess.last.start', 'otherScorer', false],
    ]);
  });

  it('has no group while nothing is recorded', () => {
    const folded = foldOf([]);
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.history).toEqual([]);
  });
});

describe('foldChess: the last tap', () => {
  it('is the last event the pad has words for, and an Undo names the tap it took back', () => {
    expect(displayOf([start(), pairing('A')]).lastTap).toEqual({ kind: 'swap' });
    expect(displayOf([start(), result('H', 'time')]).lastTap).toEqual({
      kind: 'result',
      winner: 'first',
      method: 'time',
    });
    expect(displayOf([start(), result(null), voiding(2)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', outcome: 'draw', method: null },
    });
  });

  it('reads a pairing card that names no White as no swap: the colours stand and no row says so', () => {
    const card: Spec = { type: 'boardgame.pairing', payload: { homePerson: 'p-sharma' } };
    const folded = foldOf([start(), card]);
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.display.colorOfHome).toBe('W');
    expect(folded.display.lastTap).toEqual({ kind: 'start' });
    expect(folded.history[0]?.rows.map((row) => row.said.key)).toEqual([
      'scoring.chess.last.start',
    ]);
  });

  it('names an undone win by the colour its player held: after a pairing, home’s win was Black’s', () => {
    expect(displayOf([start(), pairing('A'), result('H'), voiding(3)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', outcome: 'black', method: null },
    });
    expect(displayOf([start(), result('H'), voiding(2)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', outcome: 'white', method: null },
    });
  });

  it('names the winner by the seat they sit in, whoever holds White', () => {
    expect(displayOf([start(), pairing('A'), result('H')]).lastTap).toEqual({
      kind: 'result',
      winner: 'first',
      method: null,
    });
  });

  it('passes over events the pad has no words for: the organiser’s lock leaves the result the last tap', () => {
    expect(displayOf([start(), result('H'), finalize()]).lastTap).toEqual({
      kind: 'result',
      winner: 'first',
      method: null,
    });
  });

  it('is nothing before anything the pad has words for was recorded', () => {
    expect(displayOf([forfeit('A')]).lastTap).toBeNull();
  });
});
