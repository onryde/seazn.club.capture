import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import type { TableTennisTypes } from '@/domain/scoring/tableTennisPad';
import { chooseCard, startCard, type CardMove } from '@/domain/scoring/tableTennisSanction';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  DECIDED_3_0,
  DOUBLES,
  GAME_ONE_11_7,
  HOME,
  SINGLES,
  anchored,
  expedite,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  sanction,
  start,
  summary,
  timeout,
  wholeGame,
  withCfg,
  type Spec,
} from '../../../test/tableTennisLedger';

// Table tennis as the match runtime scores it (plan S2-2 Task 6): the sport's own answers to the questions the runtime
// asks of any sport. Every expected value is a literal written from the ITTF laws and the design, never computed by the
// fold or the module under test.

function inputOf(specs: readonly Spec[], bootstrap: Bootstrap = SINGLES): SportFoldInput {
  return { bootstrap, ledger: ledgerOf(specs), queued: [], ownEventIds: [], toss: null };
}

function displayOf(specs: readonly Spec[]) {
  const fold = tableTennisSport.fold(inputOf(specs));
  if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
  return fold.display;
}

/** Game 2 of a match the top side leads 1–0: 11–9 to the top side (nine each, then two). */
const GAME_TWO_11_9: readonly Spec[] = [...rallies('HA'.repeat(9)), ...rallies('HH')];

describe('tableTennisSport: which sport it is', () => {
  it('is the bootstrap’s tabletennis, folded at epoch 2 (ruling 53), read from the engine', () => {
    expect(tableTennisSport.key).toBe('tabletennis');
    expect(tableTennisSport.epoch).toBe(2);
    expect(tableTennisSport.epoch).toBe(foldEpochOf('tabletennis'));
  });

  it('remembers its fold: the same input is folded once, another is folded again', () => {
    const input = inputOf([start()]);
    expect(tableTennisSport.fold(input)).toBe(tableTennisSport.fold(input));
    expect(tableTennisSport.fold(inputOf([start(), ...rallies('H')]))).not.toBe(
      tableTennisSport.fold(input),
    );
  });
});

describe('tableTennisSport.resultLine', () => {
  it('says nothing before a game is over, however many points are on the board', () => {
    expect(tableTennisSport.resultLine(displayOf([]))).toBe('');
    expect(tableTennisSport.resultLine(displayOf([start(), ...rallies('HAH')]))).toBe('');
  });

  it('says a game over as its two scores, the top side first', () => {
    expect(tableTennisSport.resultLine(displayOf(GAME_ONE_11_7))).toBe('11–7');
  });

  it('says the games over in order, joined by a comma, whoever won each', () => {
    const three = [...GAME_ONE_11_7, ...GAME_TWO_11_9, ...rallies('A'.repeat(11))];
    expect(tableTennisSport.resultLine(displayOf([...GAME_ONE_11_7, ...GAME_TWO_11_9]))).toBe(
      '11–7, 11–9',
    );
    expect(tableTennisSport.resultLine(displayOf(three))).toBe('11–7, 11–9, 0–11');
  });

  it('says a game entered whole at its score', () => {
    expect(tableTennisSport.resultLine(displayOf([start(), wholeGame(4, 11)]))).toBe('4–11');
  });

  it('says the whole of a decided match', () => {
    const display = displayOf(DECIDED_3_0);
    expect(tableTennisSport.decided(display)).toBe(true);
    expect(tableTennisSport.resultLine(display)).toBe('11–0, 11–0, 11–0');
  });
});

describe('tableTennisSport: the match’s state', () => {
  it('is not started until the match starts, then not again', () => {
    expect(tableTennisSport.notStarted(displayOf([]))).toBe(true);
    expect(tableTennisSport.notStarted(displayOf([start()]))).toBe(false);
    expect(tableTennisSport.notStarted(displayOf(GAME_ONE_11_7))).toBe(false);
  });

  it('is decided only when the last game of the match is won', () => {
    expect(tableTennisSport.decided(displayOf(GAME_ONE_11_7))).toBe(false);
    expect(tableTennisSport.decided(displayOf(DECIDED_3_0))).toBe(true);
  });

  it('never waits on an ending: table tennis declares none, a red card included', () => {
    const states = [
      [],
      [start()],
      anchored('H', 'AH'),
      [...anchored('H', 'AH'), sanction('H', 'penalty', 'p-sharma')],
      DECIDED_3_0,
    ];
    for (const specs of states) {
      expect(tableTennisSport.awaitingEnding(displayOf(specs))).toBe(false);
    }
  });
});

describe('tableTennisSport: a tap', () => {
  it('picks the side to serve first with the Start tap only', () => {
    expect(tableTennisSport.tossOf({ kind: 'start', server: 'second' })).toBe('second');
    const others = [
      { kind: 'rally', side: 'first', serving: 'second' },
      { kind: 'returns', side: 'first' },
      { kind: 'timeout', side: 'first' },
      { kind: 'expedite' },
      { kind: 'sanction', side: 'first', level: 'warning', person: null },
      { kind: 'setScore', first: 1, second: 2 },
    ] as const;
    for (const tap of others) expect(tableTennisSport.tossOf(tap), tap.kind).toBeNull();
  });

  it('refuses a set score the match cannot reach as an invalid score, any other tap as not now', () => {
    expect(tableTennisSport.refusalFor({ kind: 'setScore', first: 40, second: 2 })).toBe(
      'invalidScore',
    );
    expect(tableTennisSport.refusalFor({ kind: 'rally', side: 'first', serving: null })).toBe(
      'notNow',
    );
    expect(
      tableTennisSport.refusalFor({
        kind: 'sanction',
        side: 'second',
        level: 'penalty',
        person: null,
      }),
    ).toBe('notNow');
  });

  it('is the event table tennis records: the timeout and the card, by entrant', () => {
    const display = displayOf(anchored('H', 'A'));
    const context = { bootstrap: SINGLES, display };
    expect(tableTennisSport.eventFor({ kind: 'timeout', side: 'second' }, context)).toEqual({
      type: 'tabletennis.timeout',
      payload: { by: AWAY },
    });
    expect(
      tableTennisSport.eventFor(
        { kind: 'sanction', side: 'first', level: 'penalty', person: 'A. Sharma' },
        context,
      ),
    ).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: HOME, level: 'penalty', person: 'p-sharma' },
    });
  });

  it('sends a rally’s serving only while no rally of the ledger already names one', () => {
    const queued = queuedOf('k1', rally({ wonBy: 'H', serving: 'H' }));
    expect(tableTennisSport.payloadForSend(queued, [])).toEqual({ wonBy: HOME, serving: HOME });
    const taken = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    expect(tableTennisSport.payloadForSend(queued, taken)).toEqual({ wonBy: HOME });
  });
});

describe('tableTennisSport: Undo', () => {
  it('names the last tap once it is taken back, a card by its player', () => {
    const point = tableTennisSport.undoneOf(displayOf(anchored('H', 'A')));
    expect(point).toEqual({ kind: 'rally', side: 'second', won: 'none', game: 1 });
    const card = tableTennisSport.undoneOf(
      displayOf([...anchored('H', 'A'), sanction('A', 'warning', 'p-chen')]),
    );
    expect(card).toEqual({ kind: 'sanction', side: 'second', level: 'warning', person: 'L. Chen' });
  });

  it('names a timeout, Expedite and a set score as they are', () => {
    expect(tableTennisSport.undoneOf(displayOf([start(), timeout('H')]))).toEqual({
      kind: 'timeout',
      side: 'first',
    });
    expect(tableTennisSport.undoneOf(displayOf([start(), expedite()]))).toEqual({
      kind: 'expedite',
    });
    expect(tableTennisSport.undoneOf(displayOf([start(), summary(3, 2)]))).toEqual({
      kind: 'setScore',
      first: 3,
      second: 2,
    });
  });

  it('names nothing for the start, whose Undo returns to the Start screen, nor before it', () => {
    expect(tableTennisSport.undoneOf(displayOf([start()]))).toBeNull();
    expect(tableTennisSport.undoneOf(displayOf([]))).toBeNull();
  });

  it('names nothing once the last tap is an Undo already, and shows an Undo on the display', () => {
    const display = displayOf(anchored('H', 'A'));
    const tap = tableTennisSport.undoneOf(display);
    if (tap === null) throw new Error('expected a tap');
    const shown = tableTennisSport.showUndone(display, tap);
    expect(shown.lastTap).toEqual({ kind: 'undone', tap });
    expect(tableTennisSport.undoneOf(shown)).toBeNull();
    expect(shown.points).toBe(display.points);
  });
});

describe('tableTennisSport: the pad', () => {
  it('is table tennis’s: a Card for each side and More while the match is on, none before it starts', () => {
    const live = tableTennisSport.pad(displayOf(anchored('H', 'A')), { kind: 'synced' });
    expect(live.tools.map((tool) => tool.id)).toEqual(['card.first', 'card.second', 'more']);
    expect(live.halves.map((half) => half.value)).toEqual(['1', '1']);
    expect(tableTennisSport.pad(displayOf([]), { kind: 'synced' }).tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A card, from the pad's steps to the event the server records
// ---------------------------------------------------------------------------------------------------------------

/** The organiser named only the teams: a seat with a name and no players. */
const TEAMS: Bootstrap = {
  ...SINGLES,
  sides: {
    home: { ...SINGLES.sides.home!, name: 'Hawks', kind: 'team', members: [], lineup: [] },
    away: { ...SINGLES.sides.away!, name: 'Owls', kind: 'team', members: [], lineup: [] },
  },
};

/** The steps a scorer makes (level, then each choice that follows), ending in the event the card records. */
function cardEvent(bootstrap: Bootstrap, side: 'first' | 'second', choices: readonly string[]) {
  const fold = tableTennisSport.fold(inputOf([start()], bootstrap));
  if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
  let move: CardMove = { kind: 'step', step: startCard(side) };
  for (const choice of choices) {
    if (move.kind !== 'step') throw new Error('the card was recorded before the last choice');
    move = chooseCard(move.step, choice, fold.display.sides);
  }
  if (move.kind !== 'record') throw new Error('the steps did not end in a card');
  const tap = { kind: 'sanction', ...move.card } as const;
  return tableTennisSport.eventFor(tap, { bootstrap, display: fold.display });
}

describe('a card, from the pad’s steps to the event', () => {
  it('singles: the level alone records it, against the one player', () => {
    expect(cardEvent(SINGLES, 'second', ['penalty'])).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: AWAY, level: 'penalty', person: 'p-chen' },
    });
  });

  it('doubles: the level, then the player chosen, records it against that player', () => {
    expect(cardEvent(DOUBLES, 'first', ['warning', '1'])).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: HOME, level: 'warning', person: 'p-iyer' },
    });
    expect(cardEvent(DOUBLES, 'second', ['penalty', '0'])).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: AWAY, level: 'penalty', person: 'p-chen' },
    });
  });

  it('a side the organiser named only as a team: recorded by the side, with no person', () => {
    expect(cardEvent(TEAMS, 'first', ['warning'])).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: HOME, level: 'warning' },
    });
    expect(cardEvent(TEAMS, 'second', ['penalty'])).toEqual({
      type: 'tabletennis.sanction',
      payload: { by: AWAY, level: 'penalty' },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The sport through the match runtime: the sequence a scorer makes, not the answers one at a time
// ---------------------------------------------------------------------------------------------------------------

const NOW = 1_000_000;
const AT = '2026-11-03T10:30:00.000Z';

function heldOf(specs: readonly Spec[]): MatchHeld<TableTennisTypes> {
  return {
    sport: tableTennisSport,
    queue: {
      fixtureId: SINGLES.fixtureId,
      label: 'Match 4',
      pending: [],
      ownEventIds: [],
      dead: null,
    },
    ledger: ledgerOf(specs),
    bootstrap: SINGLES,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
  };
}

function readyAs(specs: readonly Spec[]): MatchState<TableTennisTypes> {
  const opened = openMatch(heldOf(specs), NOW);
  return step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
}

function padOf(state: MatchState<TableTennisTypes>) {
  const view = viewOf(state);
  if (view.kind !== 'pad') throw new Error(`not a pad: ${view.kind}`);
  return view;
}

describe('a table tennis match through the runtime', () => {
  it('opens as a pad on the Start screen, not as an unsupported sport', () => {
    const view = padOf(readyAs([]));
    expect(view.view.start).not.toBeNull();
    expect(view.view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('starts, scores and takes a point back: the pick rides the first rally, the queue holds each tap', () => {
    let state = readyAs([]);
    const tap = (kind: 'tap' | 'undo', key: string, body?: object) => {
      const event =
        kind === 'tap'
          ? { kind, tap: body as TableTennisTypes['tap'], key, at: AT }
          : ({ kind, key, at: AT } as const);
      const result = step(state, event, NOW);
      expect(result.outcome, key).toEqual({ ok: true });
      state = result.state;
    };

    tap('tap', 's1', { kind: 'start', server: 'first' });
    expect(padOf(state).view.start).toBeNull();
    expect(state.toss).toBe('first');

    tap('tap', 'k1', { kind: 'rally', side: 'second', serving: null });
    const pending = state.sync.queue.pending;
    expect(pending.map((queued) => [queued.key, queued.type])).toEqual([
      ['s1', 'core.start'],
      ['k1', 'tabletennis.rally'],
    ]);
    expect(pending[1].payload).toEqual({ wonBy: AWAY, serving: HOME, scorer: 'p-chen' });
    expect(padOf(state).view.halves.map((half) => half.value)).toEqual(['0', '1']);

    tap('undo', 'u1');
    expect(state.sync.queue.pending.map((queued) => queued.key)).toEqual(['s1']);
    expect(padOf(state).view.halves.map((half) => half.value)).toEqual(['0', '0']);
  });

  it('refuses a card the match does not record, as not now, and queues nothing', () => {
    const bootstrap = withCfg(SINGLES, {
      records: { timeouts: true, sanctions: false, substitutions: false, expedite: true },
    });
    const opened = openMatch({ ...heldOf([start()]), bootstrap }, NOW);
    const state = step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
    const tap = { kind: 'sanction', side: 'first', level: 'warning', person: 'A. Sharma' } as const;
    const result = step(state, { kind: 'tap', tap, key: 'c1', at: AT }, NOW);
    expect(result.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(result.state.sync.queue.pending).toEqual([]);
  });
});
