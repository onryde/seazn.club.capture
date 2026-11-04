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
/** The live match as its config leaves it with no cards recorded: More lists the timeouts only. */
const NO_CARDS = snapshotOf(anchored('H', 'A'), {
  bootstrap: {
    ...SINGLES,
    cfg: { records: { timeouts: true, sanctions: false, substitutions: false, expedite: true } },
  },
});

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

/** Opens a Card step from More, as the scorer does (ruling 54: the Card cells are More's items): More, past its bounce window, the item. */
async function openCard(
  view: ReturnType<typeof mount>,
  item: 'card.first' | 'card.second',
): Promise<void> {
  act(() => view.result.current.actions.tool('more'));
  await view.wait();
  act(() => view.result.current.actions.choose(item));
}

describe('Card (design §4.7, ruling 54): in More; the level, then the player only of a pair', () => {
  it('opens the level step for the side whose Card was chosen in More: yellow, then red, from the engine', async () => {
    const view = mount(LIVE);
    await openCard(view, 'card.second');
    expect(view.result.current.view).toMatchObject({
      kind: 'card',
      sheet: { title: { key: 'scoring.tabletennis.sheet.card' }, body: 'L. Chen' },
    });
    expect(optionIds(view.result.current.view)).toEqual(['warning', 'penalty']);
  });

  it('takes More’s place: one cover at a time', async () => {
    const view = mount(LIVE);
    act(() => view.result.current.actions.tool('more'));
    expect(view.result.current.view?.kind).toBe('more');
    await view.wait();
    act(() => view.result.current.actions.choose('card.first'));
    expect(view.result.current.view?.kind).toBe('card');
  });

  it('records a singles card at once with the side’s one player, and closes the sheet', async () => {
    const view = mount(LIVE);
    await openCard(view, 'card.second');
    await view.wait();
    act(() => view.result.current.actions.choose('penalty'));
    expect(view.calls).toEqual([['card', { side: 'second', level: 'penalty', person: 'L. Chen' }]]);
    expect(view.recorded).toEqual(['sanction']);
    expect(view.result.current.view).toBeNull();
    expect(view.result.current.open).toBe(false);
  });

  it('asks a pair which player, then records with that player', async () => {
    const view = mount(DOUBLES_LIVE);
    await openCard(view, 'card.first');
    await view.wait();
    act(() => view.result.current.actions.choose('warning'));
    expect(view.result.current.view).toMatchObject({
      kind: 'card',
      sheet: { title: { key: 'scoring.sanction.who' } },
    });
    expect(optionIds(view.result.current.view)).toEqual(['0', '1']);
    expect(view.calls).toEqual([]);
    await view.wait();
    act(() => view.result.current.actions.choose('1'));
    expect(view.calls).toEqual([['card', { side: 'first', level: 'warning', person: 'R. Iyer' }]]);
    expect(view.result.current.view).toBeNull();
  });

  it('takes no choice in the bounce window of its step appearing: the second touch of a double tap on More’s item', async () => {
    const view = mount(LIVE);
    await openCard(view, 'card.first');
    act(() => view.result.current.actions.choose('warning'));
    expect(view.calls).toEqual([]);
    expect(view.result.current.view?.kind).toBe('card');
  });

  it('leaves the step as it is for a choice it does not offer', async () => {
    const view = mount(LIVE);
    await openCard(view, 'card.first');
    await view.wait();
    act(() => view.result.current.actions.choose('disqualification'));
    expect(view.calls).toEqual([]);
    expect(optionIds(view.result.current.view)).toEqual(['warning', 'penalty']);
  });

  it('Cancel closes it with nothing recorded', async () => {
    const view = mount(LIVE);
    await openCard(view, 'card.first');
    await view.wait();
    act(() => view.result.current.actions.cancel());
    expect(view.result.current.view).toBeNull();
    expect(view.calls).toEqual([]);
  });
});

describe('More (design §5.3, ruling 54): the cards and the timeouts; the timeouts record at once', () => {
  it('lists a Card for each side, then a timeout for each, the full words with the side as typed', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    expect(result.current.view).toMatchObject({
      kind: 'more',
      sheet: { title: { key: 'scoring.tabletennis.tool.more' }, body: null },
    });
    expect(optionIds(result.current.view)).toEqual([
      'card.first',
      'card.second',
      'timeout.first',
      'timeout.second',
    ]);
    expect(optionsOf(result.current.view).map((option) => option.label)).toEqual([
      { key: 'scoring.tabletennis.more.card', vars: { side: 'A. Sharma' } },
      { key: 'scoring.tabletennis.more.card', vars: { side: 'L. Chen' } },
      { key: 'scoring.tabletennis.more.timeout', vars: { side: 'A. Sharma' } },
      { key: 'scoring.tabletennis.more.timeout', vars: { side: 'L. Chen' } },
    ]);
  });

  it('lists neither Expedite nor Set score, whichever the display offers: they are cells', () => {
    for (const snapshot of [LIVE, EXPEDITED, UNANCHORED]) {
      const { result } = mount(snapshot);
      act(() => result.current.actions.tool('more'));
      expect(optionIds(result.current.view)).toEqual([
        'card.first',
        'card.second',
        'timeout.first',
        'timeout.second',
      ]);
    }
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

  it('takes no item in the bounce window of More appearing: the second touch of a double tap on the tool', () => {
    const { result, calls } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    act(() => result.current.actions.choose('timeout.first'));
    act(() => result.current.actions.choose('card.first'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('more');
  });

  it('an id More does not list does nothing: not a forfeit, and no longer Expedite or Set score', async () => {
    const { result, calls, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('more'));
    await wait();
    for (const id of ['forfeit', 'expedite', 'setScore']) {
      act(() => result.current.actions.choose(id));
      expect(calls, id).toEqual([]);
      expect(result.current.view?.kind, id).toBe('more');
    }
  });

  // Task 7 fix round 1 (M2): an item is taken only if More still lists it at the moment of the choice. The sheet was
  // drawn from the display before, and another scorer may have moved it since (here, the match stops recording cards).
  it('an item the display no longer lists closes the sheet and does nothing', async () => {
    const { result, rerender, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    await wait();
    rerender({ snapshot: NO_CARDS });
    expect(result.current.view?.kind).toBe('more');
    act(() => result.current.actions.choose('card.first'));
    expect(calls).toEqual([]);
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('a timeout still listed is taken, with the display as it moved', async () => {
    const { result, rerender, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('more'));
    await wait();
    rerender({ snapshot: EXPEDITED });
    act(() => result.current.actions.choose('timeout.second'));
    expect(calls).toEqual([['timeout', 'second']]);
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

describe('Set score (design §5.3, ruling 54): a cell of its own, before a game’s first point', () => {
  it('opens at once from its cell: the game, the names, the points so far and the engine’s bound', () => {
    const { result } = mount(UNANCHORED);
    act(() => result.current.actions.tool('setScore'));
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
    act(() => result.current.actions.tool('setScore'));
    await wait();
    act(() => result.current.actions.saveScore('7', '5'));
    expect(calls).toEqual([['setScore', 7, 5]]);
    expect(recorded).toEqual(['setScore']);
    expect(result.current.view).toBeNull();
  });

  it('refuses a score that is not whole numbers, records nothing, and closes the sheet', async () => {
    const { result, calls, refused, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('setScore'));
    await wait();
    act(() => result.current.actions.saveScore('7', 'x'));
    expect(calls).toEqual([]);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(result.current.view).toBeNull();
  });

  // Fix round 2 (M3 of the Batch C review): Set score is offered before a game's first point only. Another scorer's point
  // under the open sheet ends that, and a save would be a game score set into the middle of a game.
  it('goes away when a point lands under it: Set score is no longer on offer', async () => {
    const { result, rerender, wait } = mount(UNANCHORED);
    act(() => result.current.actions.tool('setScore'));
    await wait();
    expect(result.current.view?.kind).toBe('setScore');
    rerender({ snapshot: LIVE });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('a press on its cell after a game is under way opens nothing', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool('setScore'));
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('stays while the display moves but still offers Set score', async () => {
    const { result, rerender } = mount(UNANCHORED);
    act(() => result.current.actions.tool('setScore'));
    rerender({ snapshot: snapshotOf([start(), expedite()]) });
    expect(result.current.view?.kind).toBe('setScore');
  });

  it('takes no save in the bounce window of the sheet appearing', () => {
    const { result, calls } = mount(UNANCHORED);
    act(() => result.current.actions.tool('setScore'));
    act(() => result.current.actions.saveScore('7', '5'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('setScore');
  });
});

describe('Expedite (ruling 55): a cell that asks first, "Start Expedite?"', () => {
  it('opens the question from its cell: the words, one choice, Start', () => {
    const { result, calls } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    expect(result.current.view).toEqual({
      kind: 'expedite',
      sheet: {
        title: { key: 'scoring.tabletennis.expedite.title' },
        body: { key: 'scoring.tabletennis.expedite.body' },
        options: [
          { id: 'start', label: { key: 'scoring.tabletennis.expedite.start' }, tone: 'standard' },
        ],
      },
    });
    expect(calls).toEqual([]);
  });

  it('Start records Expedite once, through the bounce memory, and the question leaves with it', async () => {
    const { result, calls, recorded, wait } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    await wait();
    act(() => result.current.actions.choose('start'));
    expect(calls).toEqual([['expedite']]);
    expect(recorded).toEqual(['expedite']);
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('Cancel closes it and records nothing', async () => {
    const { result, calls, recorded, wait } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    await wait();
    act(() => result.current.actions.cancel());
    expect(result.current.view).toBeNull();
    expect(calls).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('takes no Start in the bounce window of the question appearing: the second touch of a double tap on the cell', () => {
    const { result, calls } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    act(() => result.current.actions.choose('start'));
    expect(calls).toEqual([]);
    expect(result.current.view?.kind).toBe('expedite');
  });

  it('does nothing for a choice that is not Start', async () => {
    const { result, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    await wait();
    for (const id of ['expedite', 'timeout.first', 'first', '']) {
      act(() => result.current.actions.choose(id));
      expect(calls, id).toEqual([]);
      expect(result.current.view?.kind, id).toBe('expedite');
    }
  });

  it('a choice with no question open does nothing', async () => {
    const { result, calls, wait } = mount(LIVE);
    await wait();
    act(() => result.current.actions.choose('start'));
    expect(calls).toEqual([]);
  });

  // Ruling 55's stale rule, as More's re-check: the question was drawn while Expedite was on offer, and another scorer may
  // have started it since. Then nothing is left to ask, and a Start would record a second Expedite.
  it('goes away when Expedite is no longer offered under it: another scorer started it', async () => {
    const { result, rerender, calls, wait } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    await wait();
    expect(result.current.view?.kind).toBe('expedite');
    rerender({ snapshot: EXPEDITED });
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
    act(() => result.current.actions.choose('start'));
    expect(calls).toEqual([]);
  });

  it('stays while the display moves but still offers Expedite', async () => {
    const { result, rerender } = mount(UNANCHORED);
    act(() => result.current.actions.tool('expedite'));
    rerender({ snapshot: LIVE });
    expect(result.current.view?.kind).toBe('expedite');
  });

  it('a press on its cell after Expedite is in force opens nothing', () => {
    const { result } = mount(EXPEDITED);
    act(() => result.current.actions.tool('expedite'));
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it('a tool replaces the question, as it does any sheet', () => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool('expedite'));
    act(() => result.current.actions.tool('more'));
    expect(result.current.view?.kind).toBe('more');
  });
});

describe('Who is serving? (design §4.2, ruling 51): two sides, one answer', () => {
  it('lists the two sides as typed, top first', () => {
    const { result } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    expect(result.current.view).toMatchObject({
      kind: 'serving',
      sheet: { title: { key: 'scoring.tabletennis.sheet.serving' }, body: null },
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

  // Task 7 fix round 1 (M4): the sheet's choice is the one door; there is no action to answer without it.
  it('offers no way to answer but the sheet’s choice', () => {
    const { result } = mount(UNANCHORED);
    expect(Object.keys(result.current.actions)).not.toContain('pickServing');
  });

  it('a choice of a side with no sheet open does nothing', async () => {
    const { result, calls, wait } = mount(UNANCHORED);
    await wait();
    act(() => result.current.actions.choose('first'));
    expect(calls).toEqual([]);
  });

  it('takes no answer in the bounce window of the sheet appearing', () => {
    const { result, calls } = mount(UNANCHORED);
    act(() => result.current.actions.tool('serving'));
    act(() => result.current.actions.choose('first'));
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
  // The Card cells are gone (ruling 54): an id that once opened the Card steps now opens nothing.
  const NOBODYS = [
    '',
    'returns.first',
    'returns.second',
    'undo',
    'card.first',
    'card.second',
    'card.third',
    'MORE',
  ];

  it.each(NOBODYS)('opens nothing for the id %j', (id) => {
    const { result } = mount(LIVE);
    act(() => result.current.actions.tool(id));
    expect(result.current.view).toBeNull();
    expect(result.current.open).toBe(false);
  });

  // A tool replaces the sheet, as badminton's does (`usePadSheets`): the id nobody offers takes the open one away. On the
  // phone the dim covers the tools while a sheet is up, so this is the rule for a press that lands anyway.
  it.each(NOBODYS)(
    'takes the sheet that is open away for the id %j: a tool replaces the sheet',
    (id) => {
      const { result } = mount(LIVE);
      act(() => result.current.actions.tool('more'));
      expect(result.current.view?.kind).toBe('more');
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
