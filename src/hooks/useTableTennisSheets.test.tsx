import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TAKEN, refusing } from '@/domain/scoring/padLine';
import type { PadStateCard } from '@/domain/scoring/padView';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchHeld } from '@/domain/scoring/scoringMatchState';
import { viewAs } from '@/domain/scoring/scoringMatchView';
import type { TableTennisTypes } from '@/domain/scoring/tableTennisPad';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import {
  useTableTennisSheets,
  type TableTennisSheetDriver,
  type TableTennisSheetSnapshot,
} from '@/hooks/useTableTennisSheets';
import { TEST_NOW, createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';
import { NOW, queueOf } from '../../test/scoringMatchFixtures';
import {
  DECIDED_3_0,
  DOUBLES,
  SINGLES,
  anchored,
  expedite,
  ledgerOf,
  queuedOf,
  rally,
  start,
  type Spec,
} from '../../test/tableTennisLedger';

// The table tennis sheets (plan S2-2 Task 7; design §4.7, §5.3): Card's steps, the More sheet, Who is serving?, Set score,
// Match details, History and the reconnect question. The snapshot is the real match's, read through the reducer and the
// real fold; the driver is a stand-in that says what each sheet's button asked for. Copy is keys here; expectations are
// literals from the design and the rulings.

function snapshotOf(
  specs: readonly Spec[],
  over: Partial<MatchHeld<TableTennisTypes>> = {},
): TableTennisSheetSnapshot {
  const held: MatchHeld<TableTennisTypes> = {
    sport: tableTennisSport,
    queue: queueOf(),
    ledger: ledgerOf(specs),
    bootstrap: SINGLES,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
    ...over,
  };
  const state = step(openMatch(held, NOW).state, { kind: 'fetched', events: [] }, NOW).state;
  const pad = viewAs(tableTennisSport, state);
  if (pad.kind !== 'pad') throw new Error(`expected the pad, got ${pad.kind}`);
  return { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask };
}

/** Singles, game 1 at 1–1, home serving by the engine's own reading: every sheet is on offer, Expedite included. */
const LIVE = snapshotOf(anchored('H', 'A'));
/** The same match with Expedite in force. */
const EXPEDITED = snapshotOf([...anchored('H', 'A'), expedite()]);
/** Started by another scorer who named no first server: the engine can name nobody, and no point stands. */
const UNANCHORED = snapshotOf([start()]);
const DOUBLES_LIVE = snapshotOf(anchored('H', 'A'), { bootstrap: DOUBLES });
const DECIDED = snapshotOf(DECIDED_3_0);

/** The match as it stands with the question put: two taps queued, the web's rally brought in by the first read. */
function asked(): TableTennisSheetSnapshot {
  const queue = queueOf({
    pending: [queuedOf('k1', rally({ wonBy: 'H' })), queuedOf('k2', rally({ wonBy: 'H' }))],
  });
  const web = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })], '2026-11-03T10:31:00.000Z');
  const opened = openMatch(
    {
      sport: tableTennisSport,
      queue,
      ledger: ledgerOf([start()]),
      bootstrap: SINGLES,
      toss: null,
      judge: 'fold',
      foreground: true,
      rulesVersion: 1,
      decidedAt: null,
    },
    NOW,
  ).state;
  const state = step(opened, { kind: 'fetched', events: web.slice(1) }, NOW).state;
  const pad = viewAs(tableTennisSport, state);
  if (pad.kind !== 'pad') throw new Error(`expected the pad, got ${pad.kind}`);
  return { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask };
}

function driver() {
  const calls: unknown[][] = [];
  const say = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return TAKEN;
    });
  const made: TableTennisSheetDriver = {
    card: say('card'),
    timeout: say('timeout'),
    expedite: say('expedite'),
    setScore: say('setScore'),
    serving: say('serving'),
  };
  return { made, calls };
}

function mount(initial: TableTennisSheetSnapshot | null) {
  const fakes = createFakePorts();
  const { made, calls } = driver();
  const recorded: string[] = [];
  const refused = vi.fn();
  const view = renderHook(
    ({ snapshot }: { snapshot: TableTennisSheetSnapshot | null }) =>
      useTableTennisSheets(
        made,
        snapshot,
        (tap, make) => {
          recorded.push(tap);
          return make().ok;
        },
        refused,
      ),
    { wrapper: wrapperFor(fakes), initialProps: { snapshot: initial } },
  );
  /** Past the bounce window (250 ms) of the sheet that just appeared. */
  const wait = () => act(() => fakes.setNow(new Date(fakes.ports.clock().getTime() + 1000)));
  return { ...view, fakes, calls, recorded, refused, wait };
}

/** The options of the step on screen, whole: a sheet view that has none is a failed test, not a type to narrow. */
const optionsOf = (view: unknown) =>
  (view as { sheet: { options: { id: string; label: unknown; tone: string }[] } }).sheet.options;
const optionIds = (view: unknown) => optionsOf(view).map((option) => option.id);

describe('Card (design §4.7): the level, then the player only of a pair', () => {
  it('opens the level step for the side whose Card was pressed: yellow, then red, from the engine', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool('card.second'));
    expect(result.current.view).toMatchObject({
      kind: 'card',
      sheet: { title: { key: 'scoring.tabletennis.tool.card' }, body: 'L. Chen' },
    });
    expect(optionIds(result.current.view)).toEqual(['warning', 'penalty']);
  });

  it('records a singles card at once with the side’s one player, and closes the sheet', async () => {
    const { result, calls, recorded, wait } = mount(LIVE);
    act(() => result.current.actions.tool('card.second'));
    await wait();
    act(() => result.current.actions.choose('penalty'));
    expect(calls).toEqual([['card', { side: 'second', level: 'penalty', person: 'L. Chen' }]]);
    expect(recorded).toEqual(['sanction']);
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('asks a pair which player, then records with that player', async () => {
    const { result, calls, wait } = mount(DOUBLES_LIVE);
    act(() => result.current.actions.tool('card.first'));
    await wait();
    act(() => result.current.actions.choose('warning'));
    expect(result.current.view).toMatchObject({
      kind: 'card',
      sheet: { title: { key: 'scoring.sanction.who' } },
    });
    expect(optionIds(result.current.view)).toEqual(['0', '1']);
    expect(calls).toEqual([]);
    await wait();
    act(() => result.current.actions.choose('1'));
    expect(calls).toEqual([['card', { side: 'first', level: 'warning', person: 'R. Iyer' }]]);
    expect(result.current.view).toBeNull();
  });

  it('takes no choice in the bounce window of its step appearing: the second touch of a double tap', () => {
    const { result, calls } = mount(LIVE);
    act(() => result.current.actions.tool('card.first'));
    act(() => result.current.actions.choose('warning'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('card');
  });

  it('leaves the step as it is for a choice it does not offer', async () => {
    const { result, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('card.first'));
    await wait();
    act(() => result.current.actions.choose('disqualification'));
    expect(calls).toEqual([]);
    expect(optionIds(result.current.view)).toEqual(['warning', 'penalty']);
  });

  it('Cancel closes it with nothing recorded', async () => {
    const { result, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('card.first'));
    await wait();
    act(() => result.current.actions.cancel());
    expect(result.current.view).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('More (design §5.3): its items record at once, or open Set score in its place', () => {
  it('lists a timeout for each side and Expedite while it is offered', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    expect(result.current.view).toMatchObject({
      kind: 'more',
      sheet: { title: { key: 'scoring.tabletennis.tool.more' }, body: null },
    });
    expect(optionIds(result.current.view)).toEqual(['timeout.first', 'timeout.second', 'expedite']);
    expect(optionsOf(result.current.view)[1].label).toEqual({
      key: 'scoring.tabletennis.more.timeout',
      vars: { side: 'L. Chen' },
    });
  });

  it('hides Expedite once it is in force', () => {
    const { result } = mount(EXPEDITED);
    act(() => result.current.actions.tool('more'));
    expect(optionIds(result.current.view)).toEqual(['timeout.first', 'timeout.second']);
  });

  it('offers Set score before a game’s first point, and not in the middle of a game', () => {
    const before = mount(UNANCHORED);
    act(() => before.result.current.actions.tool('more'));
    expect(optionIds(before.result.current.view)).toContain('setScore');
    const during = mount(LIVE);
    act(() => during.result.current.actions.tool('more'));
    expect(optionIds(during.result.current.view)).not.toContain('setScore');
  });

  it('a timeout records at once for the side listed, and the sheet leaves with it', async () => {
    const { result, calls, recorded, wait } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('timeout.second'));
    expect(calls).toEqual([['timeout', 'second']]);
    expect(recorded).toEqual(['timeout']);
    expect(result.current.view).toBeNull();
  });

  it('Expedite records at once', async () => {
    const { result, calls, recorded, wait } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('expedite'));
    expect(calls).toEqual([['expedite']]);
    expect(recorded).toEqual(['expedite']);
    expect(result.current.view).toBeNull();
  });

  it('takes no item in the bounce window of More appearing: the second touch of a double tap on the tool', () => {
    const { result, calls } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    act(() => result.current.actions.choose('timeout.first'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('more');
  });

  it('an id More does not list does nothing', async () => {
    const { result, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('forfeit'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('more');
  });

  it('Set score takes More’s place: the game, the names, the points so far and the engine’s bound', async () => {
    const { result, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('setScore'));
    expect(result.current.view).toEqual({
      kind: 'setScore',
      game: 1,
      names: ['A. Sharma', 'L. Chen'],
      points: [0, 0],
      bound: 31,
    });
  });

  it('saves Set score as typed through the bounce memory, and closes', async () => {
    const { result, calls, recorded, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('setScore'));
    await wait();
    act(() => result.current.actions.saveScore('7', '5'));
    expect(calls).toEqual([['setScore', 7, 5]]);
    expect(recorded).toEqual(['setScore']);
    expect(result.current.view).toBeNull();
  });

  it('refuses a score that is not whole numbers, records nothing, and closes the sheet', async () => {
    const { result, calls, refused, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('setScore'));
    await wait();
    act(() => result.current.actions.saveScore('7', 'x'));
    expect(calls).toEqual([]);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(result.current.view).toBeNull();
  });

  it('Set score takes no save in the bounce window of the sheet appearing', async () => {
    const { result, calls, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('more'));
    await wait();
    act(() => result.current.actions.choose('setScore'));
    act(() => result.current.actions.saveScore('7', '5'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('setScore');
  });

  it('More goes away when nothing is left in it', () => {
    const { result, rerender } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    expect(result.current.view?.kind).toBe('more');
    rerender({ snapshot: DECIDED });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });
});

describe('Who is serving? (design §4.2, ruling 51): two sides, one answer', () => {
  it('lists the two sides as typed, top first', () => {
    const { result } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    expect(result.current.view).toMatchObject({
      kind: 'serving',
      sheet: { title: { key: 'scoring.tabletennis.tool.serving' }, body: null },
    });
    expect(optionsOf(result.current.view)).toEqual([
      { id: 'first', label: 'A. Sharma', tone: 'standard' },
      { id: 'second', label: 'L. Chen', tone: 'standard' },
    ]);
  });

  it('an answer is held through the bounce memory, and the sheet leaves with it', async () => {
    const { result, calls, recorded, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    await wait();
    act(() => result.current.actions.choose('second'));
    expect(calls).toEqual([['serving', 'second']]);
    expect(recorded).toEqual(['serving']);
    expect(result.current.view).toBeNull();
  });

  it('pickServing is the same answer without the sheet’s choice', async () => {
    const { result, calls, wait } = mount(UNANCHORED);
    await wait();
    act(() => result.current.actions.pickServing('first'));
    expect(calls).toEqual([['serving', 'first']]);
  });

  it('takes no answer in the bounce window of the sheet appearing', () => {
    const { result, calls } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    act(() => result.current.actions.choose('first'));
    act(() => result.current.actions.pickServing('first'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('serving');
  });

  it('does nothing for a choice that is neither side', async () => {
    const { result, calls, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    await wait();
    act(() => result.current.actions.choose('third'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('serving');
  });

  it('goes away when the engine names a server under it: an answer would be read by nobody', () => {
    const { result, rerender } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    expect(result.current.view?.kind).toBe('serving');
    rerender({ snapshot: LIVE });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });
});

describe('the tools that open no sheet', () => {
  it.each(['', 'returns.first', 'returns.second', 'undo', 'card.third', 'MORE'])(
    'opens nothing for the id %j, and closes nothing that is open',
    (id) => {
      const { result } = mount(LIVE);
      act(() => result.current.actions.tool(id));
      expect(result.current.view).toBeNull();
      expect(result.current.open).toBe(false);
    },
  );
});

describe('Match details and History', () => {
  it('opens the match card with the rules the match plays', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.details());
    expect(result.current.view).toMatchObject({
      kind: 'details',
      details: { context: { match: 'Match 4' } },
    });
  });

  it('opens History with the groups the fold made, and Close takes it away at once: its one button is not under its icon', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.history());
    expect(result.current.view).toEqual({ kind: 'history', groups: LIVE.history });
    act(() => result.current.actions.dismiss());
    expect(result.current.view).toBeNull();
  });

  it('keeps Match details up for a touch on the dim within the window of opening it; a moment later the dim closes it', async () => {
    const { result, wait } = mount(LIVE);
    act(() => result.current.actions.details());
    act(() => result.current.actions.dismiss());
    expect(result.current.view?.kind).toBe('details');
    await wait();
    act(() => result.current.actions.dismiss());
    expect(result.current.view).toBeNull();
  });

  it('a second Match details tap opens nothing more: one Back still closes it', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.details());
    act(() => result.current.actions.details());
    act(() => result.current.actions.cancel());
    expect(result.current.view).toBeNull();
  });

  it('shows no sheet at all while there is no match under it, and drops the one that was open', () => {
    const { result, rerender } = mount(null);
    expect(result.current.view).toBeNull();
    rerender({ snapshot: LIVE });
    act(() => result.current.actions.details());
    expect(result.current.view?.kind).toBe('details');
    rerender({ snapshot: null });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });
});

describe('the reconnect question over the pad and its cards (owner ruling 43)', () => {
  const CARDS: readonly PadStateCard[] = [
    { kind: 'notStarted' },
    { kind: 'resultRecorded', undoLeft: 45 },
    { kind: 'viewOnly' },
    { kind: 'updateNeeded', unsent: 2 },
  ];

  it('asks over the pad with the counts and the server’s score, over any sheet that was open', () => {
    const { result, rerender } = mount({ ...asked(), ask: null });
    act(() => result.current.actions.tool('more'));
    expect(result.current.view?.kind).toBe('more');
    rerender({ snapshot: asked() });
    expect(result.current.view).toMatchObject({ kind: 'ask', ask: { foreign: 1, queued: 2 } });
    expect(result.current.open).toBe(false);
  });

  it.each(CARDS)('asks over the $kind card: the scorer can answer it there', (card) => {
    const { result } = mount({ ...asked(), card });
    expect(result.current.view?.kind).toBe('ask');
  });

  it('asks nothing over a dead link’s card', () => {
    const { result } = mount({ ...asked(), card: { kind: 'linkInvalid' } });
    expect(result.current.view).toBeNull();
  });

  it('Discard asks again before it deletes, and Keep is the way back', async () => {
    const { result, fakes } = mount(asked());
    act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
    act(() => result.current.actions.askDiscard());
    expect(result.current.view?.kind).toBe('discard');
    act(() => result.current.cancel());
    expect(result.current.view?.kind).toBe('ask');
  });

  it('takes no Discard in the bounce window of the question appearing: the second touch of a double tap', () => {
    const { result } = mount(asked());
    act(() => result.current.actions.askDiscard());
    expect(result.current.view?.kind).toBe('ask');
  });

  it('a confirm whose question has gone goes with it', () => {
    const { result, rerender, fakes } = mount(asked());
    act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
    act(() => result.current.actions.askDiscard());
    rerender({ snapshot: { ...asked(), ask: null } });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('with no question the sheets are the pad’s own', () => {
    expect(mount({ ...asked(), ask: null }).result.current.view).toBeNull();
  });
});

describe('a refused answer', () => {
  it('a driver that refuses leaves the sheet closed all the same: the line says why', async () => {
    const fakes = createFakePorts();
    const refusingDriver: TableTennisSheetDriver = {
      card: () => refusing('notNow'),
      timeout: () => refusing('notNow'),
      expedite: () => refusing('notNow'),
      setScore: () => refusing('invalidScore'),
      serving: () => refusing('notNow'),
    };
    const outcomes: boolean[] = [];
    const { result } = renderHook(
      () =>
        useTableTennisSheets(
          refusingDriver,
          LIVE,
          (_tap, make) => {
            outcomes.push(make().ok);
            return false;
          },
          () => undefined,
        ),
      { wrapper: wrapperFor(fakes) },
    );
    act(() => result.current.actions.tool('more'));
    act(() => fakes.setNow(new Date(TEST_NOW.getTime() + 1000)));
    act(() => result.current.actions.choose('timeout.first'));
    expect(outcomes).toEqual([false]);
    expect(result.current.view).toBeNull();
  });
});
