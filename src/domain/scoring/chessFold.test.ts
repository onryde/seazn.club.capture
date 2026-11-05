import { describe, expect, it } from 'vitest';
import { foldChess } from '@/domain/scoring/chessFold';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  BRACKET,
  GAME,
  NO_COLOURS,
  armageddon,
  bracketWith,
  eventId,
  finalize,
  forfeit,
  groupSide,
  ledgerOf,
  pairing,
  queuedOf,
  result,
  settle,
  start,
  tiebreak,
  tiebreakRung,
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
      tiebreak: { rungs: [], pending: false, held: false, decided: null },
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
    expect(display.result).toEqual({ outcome: 'black', method: 'time' });
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

  it('a tie-break decides who advances; the game itself stays a draw', () => {
    const display = displayOf([start(), result(null, 'agreement'), tiebreak('A')], {
      bootstrap: BRACKET,
    });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'draw', method: 'agreement' });
  });

  it('a draw in a stage with no tie-break is done, not waiting', () => {
    expect(displayOf([start(), result(null)]).phase).toBe('done');
  });
});

describe('foldChess: a game the organiser settles', () => {
  it('a settled drawn bracket game is done, not waiting: the organiser has recorded the decision', () => {
    const display = displayOf([start(), result(null, 'agreement'), settle('H')], {
      bootstrap: BRACKET,
    });
    expect(display.phase).toBe('done');
  });

  it('is still a draw on the board: the settle decides who advances and never rewrites the game', () => {
    const display = displayOf([start(), result(null, 'agreement'), settle('A')], {
      bootstrap: BRACKET,
      own: [1, 2],
    });
    expect(display.result).toEqual({ outcome: 'draw', method: 'agreement' });
  });

  it('waits for the organiser again once a void takes the settle back', () => {
    const display = displayOf([start(), result(null), settle('H'), voiding(3)], {
      bootstrap: BRACKET,
    });
    expect(display.phase).toBe('tiebreak');
    expect(display.result).toBeNull();
  });

  it('leaves a settled level game that was no tie-break a done draw', () => {
    const display = displayOf([start(), result(null), settle('H')]);
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'draw', method: null });
  });

  it('is not waiting for a tie-break the settle came before: a bracket game still level keeps waiting', () => {
    expect(displayOf([start(), result(null)], { bootstrap: BRACKET }).phase).toBe('tiebreak');
  });
});

// The tie-break of a drawn knockout game (S2-3b; ruling 63; design §1, §3). The engine's own rules, folded for real:
// a drawn game in a bracket stage (`cfg.tiebreak`) waits in phase `tiebreak` when the stage lists a rung (BG-KO-3), and
// one tie-break event ends it (`boardgame.js:189-209, 284-290, 395-421`). The listed rungs are a menu in the stage's order.
describe('foldChess: the tie-break menu', () => {
  const DRAWN = [start(), result(null, 'agreement')];

  it('lists no rung outside a bracket stage, drawn or not', () => {
    expect(displayOf([start()]).tiebreak.rungs).toEqual([]);
    expect(displayOf(DRAWN).tiebreak.rungs).toEqual([]);
  });

  it('lists all three rungs, in the engine’s order, for a bracket stage that names none', () => {
    expect(displayOf([start()], { bootstrap: BRACKET }).tiebreak.rungs).toEqual([
      'rapid',
      'blitz',
      'armageddon',
    ]);
  });

  it('lists the stage’s rungs in the stage’s order, never sorted', () => {
    const stage = bracketWith(['armageddon', 'rapid']);
    expect(displayOf([start()], { bootstrap: stage }).tiebreak.rungs).toEqual([
      'armageddon',
      'rapid',
    ]);
    expect(displayOf([start()], { bootstrap: bracketWith(['blitz']) }).tiebreak.rungs).toEqual([
      'blitz',
    ]);
  });

  it('lists none for a stage whose list is empty: no tie-break games are played', () => {
    expect(displayOf([start()], { bootstrap: bracketWith([]) }).tiebreak.rungs).toEqual([]);
  });

  it('lists none when the cfg names rungs but the stage has no tie-break', () => {
    const stage = withCfg(GAME, { tiebreak: false, tiebreakRungs: ['rapid'] });
    expect(displayOf(DRAWN, { bootstrap: stage }).tiebreak.rungs).toEqual([]);
  });
});

describe('foldChess: a tie-break is owed (pending)', () => {
  const DRAWN = [start(), result(null, 'agreement')];

  it('is owed for a drawn bracket game whose stage lists a rung', () => {
    for (const stage of [BRACKET, bracketWith(['blitz']), bracketWith(['armageddon', 'rapid'])]) {
      const display = displayOf(DRAWN, { bootstrap: stage });
      expect(display.phase).toBe('tiebreak');
      expect(display.tiebreak.pending).toBe(true);
      expect(display.tiebreak.held).toBe(false);
      expect(display.tiebreak.decided).toBeNull();
    }
  });

  it('is not owed before the game is drawn: not started, live, or won', () => {
    for (const specs of [[], [start()], [start(), result('H', 'checkmate')]]) {
      expect(displayOf(specs, { bootstrap: BRACKET }).tiebreak.pending).toBe(false);
    }
  });

  it('is not owed outside a bracket stage: a drawn game is simply drawn', () => {
    const display = displayOf(DRAWN);
    expect(display.phase).toBe('done');
    expect(display.tiebreak.pending).toBe(false);
  });

  it('is not owed once the organiser has settled it by lot: lots are the organiser’s', () => {
    const display = displayOf([...DRAWN, settle('A')], { bootstrap: BRACKET });
    expect(display.tiebreak.pending).toBe(false);
    expect(display.tiebreak.decided).toBeNull();
  });

  it('is not owed after a forfeit of the drawn game', () => {
    const display = displayOf([...DRAWN, forfeit('A')], { bootstrap: BRACKET });
    expect(display.tiebreak.pending).toBe(false);
    expect(display.tiebreak.decided).toBeNull();
  });

  it('is owed again when a void takes the settle back, and when a void takes the tie-break back', () => {
    const settled = [...DRAWN, settle('H'), voiding(3)];
    expect(displayOf(settled, { bootstrap: BRACKET }).tiebreak.pending).toBe(true);
    const decided = [...DRAWN, tiebreak('H'), voiding(3)];
    expect(displayOf(decided, { bootstrap: BRACKET }).tiebreak.pending).toBe(true);
  });

  it('is owed to this phone when its own drawn result is only queued', () => {
    const queued = [queuedOf('tap-1', result(null))];
    const display = displayOf([start()], { bootstrap: BRACKET, own: [1], queued });
    expect(display.tiebreak.pending).toBe(true);
  });
});

describe('foldChess: a stage that lists no rung holds the drawn game', () => {
  const STAGE = bracketWith([]);

  it('is not owed: the game is a done draw, with no tie-break to record', () => {
    const display = displayOf([start(), result(null, 'agreement')], { bootstrap: STAGE });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'draw', method: 'agreement' });
    expect(display.tiebreak).toEqual({ rungs: [], pending: false, held: true, decided: null });
  });

  it('is held only while the organiser has not decided: a settle, a withdrawal and a void each end it', () => {
    const drawn = [start(), result(null)];
    const withdrew: Spec = {
      type: 'core.forfeit',
      payload: { by: AWAY, reason: 'withdrew' },
    };
    expect(displayOf([...drawn, settle('A')], { bootstrap: STAGE }).tiebreak.held).toBe(false);
    expect(displayOf([...drawn, withdrew], { bootstrap: STAGE }).tiebreak.held).toBe(false);
    expect(displayOf([...drawn, voiding(2)], { bootstrap: STAGE }).tiebreak.held).toBe(false);
  });

  it('is not held when the game was won, nor outside a bracket stage', () => {
    expect(displayOf([start(), result('H')], { bootstrap: STAGE }).tiebreak.held).toBe(false);
    const table = withCfg(GAME, { tiebreakRungs: [] });
    expect(displayOf([start(), result(null)], { bootstrap: table }).tiebreak.held).toBe(false);
  });

  it('is not held while a tie-break is owed: the tile is the call, not the organiser', () => {
    const display = displayOf([start(), result(null)], { bootstrap: BRACKET });
    expect(display.tiebreak.held).toBe(false);
  });
});

describe('foldChess: a tie-break decides who advances', () => {
  const DRAWN = [start(), result(null, 'agreement')];
  const decidedBy = (spec: Spec, stage: Bootstrap = BRACKET) =>
    displayOf([...DRAWN, spec], { bootstrap: stage });

  it('a rapid or blitz tie-break ends the game: done, the winner’s seat advances, the game stays a draw', () => {
    const rapid = decidedBy(tiebreakRung('rapid', 'A'));
    expect(rapid.phase).toBe('done');
    expect(rapid.result).toEqual({ outcome: 'draw', method: 'agreement' });
    expect(rapid.tiebreak).toMatchObject({
      pending: false,
      decided: { rung: 'rapid', advances: 'second' },
    });
    const blitz = decidedBy(tiebreakRung('blitz', 'H', '2–0'));
    expect(blitz.tiebreak.decided).toEqual({ rung: 'blitz', advances: 'first' });
  });

  it('the score changes nothing of who advances', () => {
    for (const score of [undefined, '2–0', '1½–½']) {
      expect(decidedBy(tiebreakRung('rapid', 'A', score)).tiebreak.decided).toEqual({
        rung: 'rapid',
        advances: 'second',
      });
    }
  });

  // BG-KO-2: the scorer names Black and the result; the engine decides who advances. White's win sends the other through;
  // Black's win and a drawn Armageddon send Black.
  it.each([
    ['H', 'white', 'second'],
    ['H', 'black', 'first'],
    ['H', 'draw', 'first'],
    ['A', 'white', 'first'],
    ['A', 'black', 'second'],
    ['A', 'draw', 'second'],
  ] as const)(
    'an Armageddon with %s on Black, result %s: the %s seat advances',
    (black, outcome, advances) => {
      const display = decidedBy(armageddon(black, outcome));
      expect(display.phase).toBe('done');
      expect(display.result?.outcome).toBe('draw');
      expect(display.tiebreak.decided).toEqual({ rung: 'armageddon', advances });
    },
  );

  it('names the seat that advances whoever holds White, since a pairing is the arbiter’s and a seat is the player’s', () => {
    const specs = [start(), pairing('A'), result(null), tiebreakRung('rapid', 'H')];
    const display = displayOf(specs, { bootstrap: BRACKET });
    expect(display.colorOfHome).toBe('B');
    expect(display.tiebreak.decided).toEqual({ rung: 'rapid', advances: 'first' });
  });

  it('reads the player of a team or a pair by the seat it sits in', () => {
    const display = decidedBy(armageddon('A', 'draw'));
    expect(display.names).toEqual({ first: 'A. Sharma', second: 'L. Chen' });
    expect(display.tiebreak.decided?.advances).toBe('second');
  });

  it('a stage that lists only blitz takes a blitz tie-break', () => {
    const display = decidedBy(tiebreakRung('blitz', 'A'), bracketWith(['blitz']));
    expect(display.tiebreak.decided).toEqual({ rung: 'blitz', advances: 'second' });
  });

  it('has no decided tie-break for a game that was simply won, in a bracket stage or a table', () => {
    for (const stage of [BRACKET, GAME]) {
      const won = displayOf([start(), result('H', 'checkmate')], { bootstrap: stage });
      expect(won.phase).toBe('done');
      expect(won.tiebreak.decided).toBeNull();
    }
  });

  it('has no decided tie-break while it is owed, or after a settle or a forfeit', () => {
    expect(displayOf(DRAWN, { bootstrap: BRACKET }).tiebreak.decided).toBeNull();
    expect(decidedBy(settle('A')).tiebreak.decided).toBeNull();
    expect(decidedBy(forfeit('A')).tiebreak.decided).toBeNull();
  });
});

describe('foldChess: a tie-break the engine refuses is not shown', () => {
  const DRAWN = [start(), result(null, 'agreement')];
  const legal = (specs: readonly Spec[], queued: readonly QueuedEvent[], over: Over = {}) => {
    const folded = foldOf(specs, { ...over, queued });
    if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
    return folded;
  };

  it('refuses a second tie-break: one ends the match', () => {
    const queued = [queuedOf('tap-2', tiebreakRung('blitz', 'H'))];
    const folded = legal([...DRAWN, tiebreak('A')], queued, { bootstrap: BRACKET });
    expect(folded.legalQueued).not.toContain('tap-2');
    expect(folded.display.tiebreak.decided).toEqual({ rung: 'rapid', advances: 'second' });
  });

  it('takes a queued tie-break on a drawn bracket game, and shows it at once', () => {
    const queued = [queuedOf('tap-3', armageddon('A', 'draw'))];
    const folded = legal(DRAWN, queued, { bootstrap: BRACKET, own: [1, 2] });
    expect(folded.legalQueued).toContain('tap-3');
    expect(folded.display.phase).toBe('done');
    expect(folded.display.tiebreak.decided).toEqual({ rung: 'armageddon', advances: 'second' });
  });

  it('refuses a rung the stage does not list: the list is authoritative (BG-KO-3)', () => {
    const queued = [queuedOf('tap-1', armageddon('H', 'white'))];
    const folded = legal(DRAWN, queued, { bootstrap: bracketWith(['rapid']) });
    expect(folded.legalQueued).not.toContain('tap-1');
    expect(folded.display.tiebreak.pending).toBe(true);
  });

  it('refuses a tie-break while the game is live, before the draw', () => {
    const queued = [queuedOf('tap-1', tiebreak('H'))];
    const folded = legal([start()], queued, { bootstrap: BRACKET });
    expect(folded.legalQueued).not.toContain('tap-1');
    expect(folded.display.phase).toBe('live');
  });

  it('refuses a tie-break in a stage with none to play', () => {
    const queued = [queuedOf('tap-1', tiebreak('H'))];
    const folded = legal(DRAWN, queued, { bootstrap: bracketWith([]) });
    expect(folded.legalQueued).not.toContain('tap-1');
  });

  it('refuses a tie-break after the organiser settled the game', () => {
    const queued = [queuedOf('tap-1', tiebreak('H'))];
    const folded = legal([...DRAWN, settle('A')], queued, { bootstrap: BRACKET });
    expect(folded.legalQueued).not.toContain('tap-1');
    expect(folded.display.tiebreak.decided).toBeNull();
  });

  it('refuses a tie-break after the organiser locked the result', () => {
    const queued = [queuedOf('tap-1', tiebreak('H'))];
    const folded = legal([...DRAWN, settle('A'), finalize()], queued, { bootstrap: BRACKET });
    expect(folded.legalQueued).not.toContain('tap-1');
  });

  it('refuses an Armageddon that names no Black: the colour is required (TIEBREAK_COLOUR_REQUIRED)', () => {
    const noBlack: Spec = {
      type: 'boardgame.tiebreak',
      payload: { rung: 'armageddon', result: 'draw' },
    };
    const folded = legal(DRAWN, [queuedOf('tap-1', noBlack)], { bootstrap: BRACKET });
    expect(folded.legalQueued).not.toContain('tap-1');
  });
});

describe('foldChess: Undo of a tie-break', () => {
  const DRAWN = [start(), result(null, 'agreement')];

  it('is offered for this phone’s own tie-break with nothing after it', () => {
    const display = displayOf([...DRAWN, tiebreak('A')], { bootstrap: BRACKET, own: [1, 2, 3] });
    expect(display.undoable).toBe(true);
  });

  it('is offered for an own tie-break that is only queued', () => {
    const queued = [queuedOf('tap-1', tiebreakRung('blitz', 'H', '2–0'))];
    const display = displayOf(DRAWN, { bootstrap: BRACKET, own: [1, 2], queued });
    expect(display.undoable).toBe(true);
  });

  it('is not offered for another scorer’s tie-break, even when this phone recorded the draw', () => {
    const display = displayOf([...DRAWN, tiebreak('A')], { bootstrap: BRACKET, own: [1, 2] });
    expect(display.undoable).toBe(false);
  });

  it('is not offered once the organiser has locked the result after it', () => {
    const specs = [...DRAWN, tiebreak('A'), finalize()];
    expect(displayOf(specs, { bootstrap: BRACKET, own: [1, 2, 3] }).undoable).toBe(false);
  });

  it('takes the tie-break back to the pending state, with the draw still this phone’s to undo', () => {
    const specs = [...DRAWN, tiebreak('A'), voiding(3)];
    const display = displayOf(specs, { bootstrap: BRACKET, own: [1, 2, 3, 4] });
    expect(display.phase).toBe('tiebreak');
    expect(display.tiebreak.pending).toBe(true);
    expect(display.tiebreak.decided).toBeNull();
    expect(display.undoable).toBe(true);
  });

  it('lets the scorer record a different tie-break after the void', () => {
    const specs = [...DRAWN, tiebreakRung('rapid', 'A'), voiding(3), armageddon('H', 'white')];
    const display = displayOf(specs, { bootstrap: BRACKET, own: [1, 2, 3, 4, 5] });
    expect(display.tiebreak.decided).toEqual({ rung: 'armageddon', advances: 'second' });
    expect(display.undoable).toBe(true);
  });

  it('leaves the draw’s own Undo to the draw while no tie-break stands, as before', () => {
    const display = displayOf(DRAWN, { bootstrap: BRACKET, own: [1, 2] });
    expect(display.undoable).toBe(true);
    expect(display.phase).toBe('tiebreak');
  });
});

describe('foldChess: the last tap names a tie-break by its seats', () => {
  const DRAWN = [start(), result(null, 'agreement')];
  const lastOf = (spec: Spec, stage: Bootstrap = BRACKET) =>
    displayOf([...DRAWN, spec], { bootstrap: stage }).lastTap;

  it('says a rapid or blitz tie-break with its winner’s seat and its score', () => {
    expect(lastOf(tiebreakRung('rapid', 'A'))).toEqual({
      kind: 'tiebreak',
      rung: 'rapid',
      winner: 'second',
      score: null,
    });
    expect(lastOf(tiebreakRung('blitz', 'H', '1½–½'))).toEqual({
      kind: 'tiebreak',
      rung: 'blitz',
      winner: 'first',
      score: '1½–½',
    });
  });

  it('says an Armageddon with its Black seat and its result, and never a winner', () => {
    const last = lastOf(armageddon('A', 'draw'));
    expect(last).toEqual({ kind: 'tiebreak', rung: 'armageddon', black: 'second', result: 'draw' });
    expect(last).not.toHaveProperty('winner');
  });

  it('reads a score the pad does not offer as none: it is not spoken', () => {
    expect(lastOf(tiebreakRung('rapid', 'H', '3–1'))).toMatchObject({ score: null });
  });

  it('says an undone tie-break as the tap that made it', () => {
    const specs = [...DRAWN, tiebreakRung('blitz', 'A', '2–0'), voiding(3)];
    expect(displayOf(specs, { bootstrap: BRACKET }).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'tiebreak', rung: 'blitz', winner: 'second', score: '2–0' },
    });
  });
});

describe('foldChess: a forfeit while the tie-break waits', () => {
  // The engine overwrites the game's method with the forfeit when the organiser forfeits a player over a drawn bracket game
  // (a draw is the classical result and stays), and the pad has no word for a forfeit, so the method it showed is gone.
  it('keeps the drawn game as the result and loses its method', () => {
    const display = displayOf([start(), result(null, 'agreement'), forfeit('A')], {
      bootstrap: BRACKET,
    });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'draw', method: null });
  });
});

describe('foldChess: what the organiser decides', () => {
  it('a walkover is done, and the player who turned up is the result’s winner, with no method', () => {
    const display = displayOf([forfeit('A')]);
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'white', method: null });
  });

  it('a double walkover is done with no result: nobody won and nobody drew', () => {
    const both: Spec = { type: 'core.forfeit', payload: { by: 'both', reason: 'walkover' } };
    const display = displayOf([both]);
    expect(display.phase).toBe('done');
    expect(display.result).toBeNull();
  });
});

describe('foldChess: whose result it is', () => {
  // The result carries no owner: whose it is shows in what Undo may take back (`undoable`), and nowhere else.
  it('is not this phone’s when another device’s link recorded it: no Undo', () => {
    expect(displayOf([start(), result('H')], { own: [1] }).undoable).toBe(false);
  });

  it('is this phone’s only when its event ids hold the result: Undo', () => {
    expect(displayOf([start(), result('H')], { own: [1, 2] }).undoable).toBe(true);
  });

  it('is this phone’s when the result is only queued', () => {
    const queued = [queuedOf('tap-1', result('A', 'resign'))];
    const display = displayOf([start()], { own: [1], queued });
    expect(display.phase).toBe('done');
    expect(display.result).toEqual({ outcome: 'black', method: 'resign' });
    expect(display.undoable).toBe(true);
  });

  it('follows the result that stands: after an Undo and another scorer’s new result it is theirs', () => {
    const specs = [start(), result('H'), voiding(2), result('A')];
    expect(displayOf(specs, { own: [1, 2, 3] }).undoable).toBe(false);
    expect(displayOf(specs, { own: [1, 2, 3, 4] }).undoable).toBe(true);
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

describe('foldChess: the names of a team or a pair', () => {
  const MEMBERS = [
    { personId: 'p-sharma', fullName: 'A. Sharma' },
    { personId: 'p-rao', fullName: 'B. Rao' },
  ] as const;
  const withSides = (home: Bootstrap['sides']['home']): Bootstrap => ({
    ...GAME,
    sides: { ...GAME.sides, home },
  });

  it('shows a team by the entrant’s name, not by its members', () => {
    const bootstrap = withSides(groupSide('ent-home', 'Bishops Chess Club', 'team', MEMBERS));
    expect(displayOf([], { bootstrap }).names).toEqual({
      first: 'Bishops Chess Club',
      second: 'L. Chen',
    });
  });

  it('shows a pair by the entrant’s name too', () => {
    const bootstrap = withSides(groupSide('ent-home', 'Sharma / Rao', 'pair', MEMBERS));
    expect(displayOf([], { bootstrap }).names.first).toBe('Sharma / Rao');
  });

  it('shows an individual by the player’s name as the organiser typed it, whatever the entrant is called', () => {
    const named = {
      ...GAME.sides.home,
      entrantId: 'ent-home',
      name: 'Seed 1',
      kind: 'individual',
      members: [{ personId: 'p-sharma', fullName: 'A. Sharma' }],
      lineup: [{ personId: 'p-sharma', pairOrder: null }],
    };
    expect(displayOf([], { bootstrap: withSides(named) }).names.first).toBe('A. Sharma');
  });

  it('says a team’s result by the entrant’s name too', () => {
    const bootstrap = withSides(groupSide('ent-home', 'Bishops Chess Club', 'team', MEMBERS));
    const folded = foldOf([start(), result('H', 'resign')], { bootstrap });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.history[0]?.rows[0]?.said).toEqual({
      key: 'scoring.chess.last.wonBy',
      vars: { name: 'Bishops Chess Club', how: { key: 'scoring.chess.method.resign' } },
    });
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
      tap: { kind: 'result', winner: null, method: null },
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

  it('names an undone win by the seat that won, whoever held White: the same tap either side of a pairing', () => {
    expect(displayOf([start(), pairing('A'), result('H'), voiding(3)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', winner: 'first', method: null },
    });
    expect(displayOf([start(), result('H'), voiding(2)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', winner: 'first', method: null },
    });
    expect(displayOf([start(), pairing('A'), result('A', 'resign'), voiding(3)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'result', winner: 'second', method: 'resign' },
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
