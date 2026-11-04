import { FOLD_EPOCH } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { chessSport } from '@/domain/scoring/chessSport';
import type { ChessDisplay, ChessTap } from '@/domain/scoring/chessTypes';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import { sportFor } from '@/domain/scoring/sports';
import type { Bootstrap } from '@/domain/scoring/wire';
import { chessSeed } from '@/services/fakeChessPad';
import { createFakeScoringPort } from '@/services/fakeScoringPort';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import {
  BRACKET,
  GAME,
  NO_COLOURS,
  chessDisplay,
  eventId,
  finalize,
  ledgerOf,
  pairing,
  result,
  start,
  voiding,
  type Spec,
} from '../../../test/chessLedger';

// Chess as the match runtime scores it (plan S2-3 Task 1): the sport's own answers to the questions the runtime asks of any
// sport. Every expected value is a literal written from the spec and FIDE's laws, never computed by the code under test.

function inputOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = GAME,
  own: readonly number[] = [],
): SportFoldInput {
  return {
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: own.map(eventId),
    toss: null,
  };
}

function displayOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = GAME,
  own: readonly number[] = [],
) {
  const fold = chessSport.fold(inputOf(specs, bootstrap, own));
  if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
  return fold.display;
}

describe('chessSport: which sport it is', () => {
  it('is the table’s boardgame row', () => {
    expect(sportFor('boardgame')).toBe(chessSport);
    expect(chessSport.key).toBe('boardgame');
  });

  it('folds at the engine’s epoch for boardgame (ruling 53), 5 at engine 2.0.0', () => {
    expect(chessSport.epoch).toBe(FOLD_EPOCH.boardgame);
    expect(chessSport.epoch).toBe(5);
  });

  it('remembers its fold: the same input is folded once, another is folded again', () => {
    const input = inputOf([start()]);
    expect(chessSport.fold(input)).toBe(chessSport.fold(input));
    expect(chessSport.fold(inputOf([start(), result('H')]))).not.toBe(chessSport.fold(input));
  });
});

describe('chessSport: the game’s state', () => {
  it('is not started until the match starts, then not again', () => {
    expect(chessSport.notStarted(displayOf([]))).toBe(true);
    expect(chessSport.notStarted(displayOf([start()]))).toBe(false);
    expect(chessSport.notStarted(displayOf([start(), result('H')]))).toBe(false);
  });

  it('is decided when a result stands or the organiser has locked it, and not while live or waiting', () => {
    expect(chessSport.decided(displayOf([]))).toBe(false);
    expect(chessSport.decided(displayOf([start()]))).toBe(false);
    expect(chessSport.decided(displayOf([start(), result(null)], BRACKET))).toBe(false);
    expect(chessSport.decided(displayOf([start(), result('H')]))).toBe(true);
    expect(chessSport.decided(displayOf([start(), result('H'), finalize()]))).toBe(true);
  });

  it('never waits on an ending: chess has none', () => {
    for (const specs of [[], [start()], [start(), result('H')]]) {
      expect(chessSport.awaitingEnding(displayOf(specs))).toBe(false);
    }
  });

  it('says nothing before a result stands', () => {
    expect(chessSport.resultLine(displayOf([start()]))).toBe('');
    expect(chessSport.resultLine(displayOf([]))).toBe('');
  });

  // Home's card writes the first side's score first (the kit's contract for `resultLine`), not White's: the line is the first
  // name's point and then the second's, whoever held White.
  it.each([
    ['home holds White and wins', [start(), result('H')], GAME, '1–0'],
    ['home holds White and loses', [start(), result('A')], GAME, '0–1'],
    ['home holds Black (a pairing) and wins', [start(), pairing('A'), result('H')], GAME, '1–0'],
    ['home holds Black (a pairing) and loses', [start(), pairing('A'), result('A')], GAME, '0–1'],
    ['a draw', [start(), result(null)], GAME, '½–½'],
    ['a draw with Black at home', [start(), pairing('A'), result(null)], GAME, '½–½'],
    ['no colours, the first side wins', [start(), result('H')], NO_COLOURS, '1–0'],
    ['no colours, the second side wins', [start(), result('A')], NO_COLOURS, '0–1'],
  ] as const)(
    'says the first side’s score first on Home’s card: %s',
    (_name, specs, game, line) => {
      expect(chessSport.resultLine(displayOf(specs, game))).toBe(line);
    },
  );
});

describe('chessSport: a tap', () => {
  const TAPS: readonly ChessTap[] = [
    { kind: 'start' },
    { kind: 'result', winner: 'first', method: null },
    { kind: 'result', winner: null, method: 'agreement' },
    { kind: 'swap' },
  ];

  it('picks no side to serve: chess has no serve, so the match keeps no pick', () => {
    for (const tap of TAPS) expect(chessSport.tossOf(tap)).toBeNull();
  });

  it('refuses a tap the game does not take as not now', () => {
    for (const tap of TAPS) expect(chessSport.refusalFor(tap)).toBe('notNow');
  });

  it('builds the event for its taps', () => {
    const display = displayOf([start()]);
    expect(chessSport.eventFor({ kind: 'start' }, { bootstrap: GAME, display })).toEqual({
      type: 'core.start',
      payload: {},
    });
  });

  it('sends a queued payload as it is', () => {
    const queued = {
      key: 'k',
      type: 'boardgame.result',
      payload: { winner: 'ent-home' },
      rulesVersion: 1,
      createdAt: '2026-11-04T10:30:00.000Z',
      attempts: 1,
    };
    expect(chessSport.payloadForSend(queued, [], false)).toEqual({ winner: 'ent-home' });
  });
});

describe('chessSport: the pad', () => {
  it('is the chess pad of the display, and carries the transport’s word the runtime gives it', () => {
    const display = displayOf([start()]);
    expect(chessSport.pad(display, { kind: 'synced' }).halves[0].tappable).toBe(true);
    expect(chessSport.pad(display, { kind: 'offline', count: 2 }).sync).toEqual({
      kind: 'offline',
      count: 2,
    });
  });
});

describe('chessSport: Undo’s line', () => {
  it('names the result Undo takes back, as the tap that made it', () => {
    const display = displayOf([start(), result('A', 'resign')], GAME, [1, 2]);
    expect(chessSport.undoneOf(display)).toEqual({
      kind: 'result',
      winner: 'second',
      method: 'resign',
    });
  });

  it('names a draw and a swap too, and the start never: its Undo returns to the Start screen', () => {
    expect(chessSport.undoneOf(displayOf([start(), result(null)]))).toEqual({
      kind: 'result',
      winner: null,
      method: null,
    });
    expect(chessSport.undoneOf(displayOf([start(), pairing('A')]))).toEqual({ kind: 'swap' });
    expect(chessSport.undoneOf(displayOf([start()]))).toBeNull();
    expect(chessSport.undoneOf(displayOf([]))).toBeNull();
  });

  it('names a win by the seat that won, whoever holds White: home’s win is the first player’s either side of a pairing', () => {
    const display = displayOf([start(), pairing('A'), result('H')], GAME, [1, 2, 3]);
    expect(chessSport.undoneOf(display)).toEqual({ kind: 'result', winner: 'first', method: null });
    const plain = displayOf([start(), result('H')], GAME, [1, 2]);
    expect(chessSport.undoneOf(plain)).toEqual({ kind: 'result', winner: 'first', method: null });
  });

  it('is nothing once an Undo is already the last tap', () => {
    expect(chessSport.undoneOf(displayOf([start(), result('H'), voiding(2)]))).toBeNull();
  });

  it('shows the tap as undone on the display, changing nothing else', () => {
    const display: ChessDisplay = chessDisplay();
    const tap: ChessTap = { kind: 'result', winner: null, method: null };
    expect(chessSport.showUndone(display, tap)).toEqual({
      ...display,
      lastTap: { kind: 'undone', tap },
    });
  });
});

describe('chessSport: the fake server’s game', () => {
  it('folds a match from chessSeed() to not started, with the sport’s own key', async () => {
    const port = createFakeScoringPort(chessSeed());
    const answer = await port.bootstrap({
      origin: 'https://stg.seazn.club',
      token: FAKE_SCORING_SECRET,
    });
    if (answer.kind !== 'ok') throw new Error('the fake did not answer');
    expect(answer.bootstrap.sportKey).toBe('boardgame');
    const fold = chessSport.fold({
      bootstrap: answer.bootstrap,
      ledger: [],
      queued: [],
      ownEventIds: [],
      toss: null,
    });
    expect(fold.kind === 'folded' && fold.display.phase).toBe('notStarted');
    expect(fold.kind === 'folded' && fold.display.colorOfHome).toBe('W');
  });
});
