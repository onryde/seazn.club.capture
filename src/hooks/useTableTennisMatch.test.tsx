import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import { useTableTennisMatch } from '@/hooks/useTableTennisMatch';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  TABLE_TENNIS_DOUBLES_SEED,
  TABLE_TENNIS_SINGLES_SEED,
  TABLE_TENNIS_UNANCHORED_SEED,
} from '@/services/fakeTableTennisPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The table tennis match hook (plan S2-2 Task 7): what the pad screen is drawn from, over the real runner, hub, queue
// store, reducer and fold, and a fake server that judges with the engine alone. Copy is keys here (the screen draws the
// words); every expectation is a literal from the design (§4, §5.3) and the controller's rulings on the held answer.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

/** Time passes: the bounce windows (250 ms) of whatever was just tapped are over. */
const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function rig(seed: FakeMatchSeed = TABLE_TENNIS_SINGLES_SEED): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'tabletennis');
  return fakes;
}

function mount(fakes: FakePorts, seed: FakeMatchSeed = TABLE_TENNIS_SINGLES_SEED) {
  return renderHook(() => useTableTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
}

type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useTableTennisMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const act_ = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

/** The ledger's events, as the server holds them. */
async function ledger(fakes: FakePorts, seed: FakeMatchSeed = TABLE_TENNIS_SINGLES_SEED) {
  const events = await fakes.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const typesOf = async (fakes: FakePorts, seed?: FakeMatchSeed) =>
  (await ledger(fakes, seed)).map((event) => event.type);

/** The taps this phone has queued and the server has not yet taken, as the queue file holds them. */
function queued(fakes: FakePorts, seed: FakeMatchSeed) {
  const text = fakes.queueFiles.files.get(`${seed.fixtureId}.json`);
  if (text === undefined) return [];
  const file = JSON.parse(text) as { pending: { type: string; payload: unknown }[] };
  return file.pending.map(({ type, payload }) => ({ type, payload }));
}

/** The rallies queued, as who won and whom the scorer said served: the pad adds players' ids of its own besides. */
const rallies = (fakes: FakePorts, seed: FakeMatchSeed) =>
  queued(fakes, seed)
    .filter((tap) => tap.type === 'tabletennis.rally')
    .map(({ payload }) => {
      const { wonBy, serving } = payload as { wonBy: string; serving?: string };
      return { wonBy, serving: serving ?? null };
    });

/** The ids offered by the step on screen: a sheet that has none is a failed test, not a type to narrow. */
const optionIds = (sheet: unknown) =>
  (sheet as { sheet: { options: { id: string }[] } }).sheet.options.map((option) => option.id);

const toolIds = (view: PadView<string>) => view.tools.map((tool) => tool.id);
const returnsCell = (view: PadView<string>) =>
  view.tools.find((tool) => tool.id.startsWith('returns.'));

/** The pad with the match started by this phone, the first side picked to serve, and the bounce window of Start over. */
async function started(fakes: FakePorts, seed: FakeMatchSeed = TABLE_TENNIS_SINGLES_SEED) {
  const view = mount(fakes, seed);
  await flush();
  act_(view, (actions) => actions.pickServer('first'));
  act_(view, (actions) => actions.start());
  await flush();
  await wait();
  return view;
}

/** One tool press and the wait that takes its bounce window away. */
async function press(view: Match, id: string) {
  act_(view, (actions) => actions.tool(id));
  await wait(300);
}

/** A choice on the sheet open, and the wait after it. */
async function choose(view: Match, id: string) {
  act_(view, (actions) => actions.choose(id));
  await flush();
  await wait(300);
}

/** A match another scorer started and named no first server for: the pad asks Who is serving? at once. */
async function unanchored() {
  const fakes = await rig(TABLE_TENNIS_UNANCHORED_SEED);
  const view = mount(fakes, TABLE_TENNIS_UNANCHORED_SEED);
  await flush();
  return { fakes, view };
}

/** Held: the answer to Who is serving?, given through the tool and its sheet, the bounce windows over. */
async function answer(view: Match, side: 'first' | 'second') {
  await press(view, 'serving');
  await choose(view, side);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Start screen', () => {
  it('shows it for a match not started, with no pick, no sheet and no tools', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    expect(view.result.current).toEqual({ kind: 'loading', offline: false });
    await flush();
    const model = pad(view);
    expect(model.toss).toBeNull();
    expect(model.view.start).not.toBeNull();
    expect(model.sheet).toBeNull();
    expect(model.view.tools).toEqual([]);
  });

  it('Start with no pick does nothing; with a pick it starts the match and drops the pick', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.start());
    await flush();
    expect(append).not.toHaveBeenCalled();
    act_(view, (actions) => actions.pickServer('second'));
    expect(pad(view).toss).toBe('second');
    act_(view, (actions) => actions.start());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start']);
    expect(pad(view).toss).toBeNull();
    expect(pad(view).view.start).toBeNull();
  });

  it('the first point carries the pick as the side that served (ruling 49)', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    act_(view, (actions) => actions.start());
    await flush();
    await wait();
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    const [, rally] = await ledger(fakes);
    expect(rally).toMatchObject({
      type: 'tabletennis.rally',
      payload: { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    });
  });
});

describe('a point', () => {
  it('counts on the half once and is sent; the plate is the engine’s', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'tabletennis.rally']);
    expect(pad(view).view.halves.map((half) => half.value)).toEqual(['1', '0']);
    expect(pad(view).view.halves[0].serving).toEqual({
      shown: { key: 'scoring.tabletennis.serving.second' },
      said: { key: 'scoring.tabletennis.servingSaid.second' },
    });
  });

  it('a second tap on the same half inside the bounce window counts once, and the line says so', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act(() => {
      pad(view).actions.tapHalf('first');
      pad(view).actions.tapHalf('first');
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'tabletennis.rally']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('a point before the match has started is refused on the line, and nothing is sent', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notNow' });
    expect(append).not.toHaveBeenCalled();
  });
});

describe('Card (ruling 54: More’s items)', () => {
  it('records a singles card with the side’s one player: More, the Card, the level, and the sheet leaves with it', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'more');
    await choose(view, 'card.second');
    expect(pad(view).sheet?.kind).toBe('card');
    await choose(view, 'warning');
    expect(pad(view).sheet).toBeNull();
    const events = await ledger(fakes);
    expect(events.at(-1)).toMatchObject({
      type: 'tabletennis.sanction',
      payload: { by: AWAY_ENTRANT, level: 'warning', person: `${AWAY_ENTRANT}-p1` },
    });
  });

  it('asks a pair which player, then records that player', async () => {
    const seed = TABLE_TENNIS_DOUBLES_SEED;
    const fakes = await rig(seed);
    const view = await started(fakes, seed);
    await press(view, 'more');
    await choose(view, 'card.first');
    await choose(view, 'penalty');
    expect(pad(view).sheet).toMatchObject({
      kind: 'card',
      sheet: { title: { key: 'scoring.sanction.who' } },
    });
    await choose(view, '1');
    expect((await ledger(fakes, seed)).at(-1)).toMatchObject({
      type: 'tabletennis.sanction',
      payload: { by: HOME_ENTRANT, level: 'penalty', person: `${HOME_ENTRANT}-p2` },
    });
  });
});

describe('More (ruling 54: the cards and the timeouts)', () => {
  it('records a timeout for the side listed, and closes', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'more');
    expect(pad(view).sheet?.kind).toBe('more');
    await choose(view, 'timeout.second');
    expect(pad(view).sheet).toBeNull();
    expect((await ledger(fakes)).at(-1)).toMatchObject({
      type: 'tabletennis.timeout',
      payload: { by: AWAY_ENTRANT },
    });
  });

  it('Set score is a cell of its own, and records a game’s score before its first point', async () => {
    const { fakes, view } = await unanchored();
    expect(toolIds(pad(view).view)).toEqual(['setScore', 'expedite', 'serving', 'more']);
    await press(view, 'setScore');
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', game: 1, bound: 31 });
    act_(view, (actions) => actions.saveScore('7', '5'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect((await ledger(fakes, TABLE_TENNIS_UNANCHORED_SEED)).at(-1)).toMatchObject({
      type: 'tabletennis.game.summary',
      payload: { home: 7, away: 5, partial: true },
    });
  });

  it('Set score is gone from the row once the game’s first point is played', async () => {
    const { view } = await unanchored();
    expect(toolIds(pad(view).view)).toContain('setScore');
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    expect(toolIds(pad(view).view)).not.toContain('setScore');
  });

  it('Back closes the sheet and falls through with none open', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'more');
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view).sheet).toBeNull();
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(false);
  });
});

describe('Expedite (ruling 55): its cell asks first, and Start records it', () => {
  /** A game under way, so Expedite is on offer: the first side served and won the first point; the bounce windows are over. */
  async function underWay() {
    const fakes = await rig();
    const view = await started(fakes);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    return { fakes, view };
  }
  const startsIn = async (fakes: FakePorts) =>
    (await typesOf(fakes)).filter((type) => type === 'tabletennis.expedite.start');

  it('opens the question and records nothing; Cancel closes it and leaves the cell', async () => {
    const { fakes, view } = await underWay();
    expect(toolIds(pad(view).view)).toEqual(['expedite', 'more']);
    await press(view, 'expedite');
    expect(pad(view).sheet?.kind).toBe('expedite');
    expect(optionIds(pad(view).sheet)).toEqual(['start']);
    act_(view, (actions) => actions.cancel());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(await startsIn(fakes)).toEqual([]);
    expect(toolIds(pad(view).view)).toEqual(['expedite', 'more']);
  });

  it('Start records one expedite.start: the cell is gone, 13 returns shows with the receiver, the strip says Expedite', async () => {
    const { fakes, view } = await underWay();
    await press(view, 'expedite');
    await choose(view, 'start');
    expect(pad(view).sheet).toBeNull();
    expect(await startsIn(fakes)).toHaveLength(1);
    expect(toolIds(pad(view).view)).not.toContain('expedite');
    // The cell names the receiver: the side without the serving plate (ITTF 2.15.2), never the server.
    const receiver = pad(view).view.halves.find((half) => half.serving === null);
    expect(receiver).toBeDefined();
    expect(returnsCell(pad(view).view)).toMatchObject({
      id: `returns.${receiver?.side}`,
      detail: receiver?.label,
    });
    expect(pad(view).view.strip).toContainEqual({
      slot: 'note',
      text: { key: 'scoring.tabletennis.note.expedite' },
    });
  });

  it('a second Start in the same moment, a double tap, records once', async () => {
    const { fakes, view } = await underWay();
    await press(view, 'expedite');
    act(() => {
      pad(view).actions.choose('start');
      pad(view).actions.choose('start');
    });
    await flush();
    expect(await startsIn(fakes)).toHaveLength(1);
  });

  it('a Start inside the bounce window of the question appearing records nothing: the second touch of a double tap on the cell', async () => {
    const { fakes, view } = await underWay();
    act(() => {
      pad(view).actions.tool('expedite');
      pad(view).actions.choose('start');
    });
    await flush();
    expect(pad(view).sheet?.kind).toBe('expedite');
    expect(await startsIn(fakes)).toEqual([]);
  });

  it('Undo of the start brings the cell back, and takes 13 returns away', async () => {
    const { fakes, view } = await underWay();
    await press(view, 'expedite');
    await choose(view, 'start');
    expect(toolIds(pad(view).view)).not.toContain('expedite');
    act_(view, (actions) => actions.undo());
    await flush();
    await wait();
    expect((await ledger(fakes)).at(-1)?.type).toBe('core.void');
    expect(toolIds(pad(view).view)).toEqual(['expedite', 'more']);
    expect(pad(view).view.lastTap?.text).toMatchObject({
      key: 'scoring.tabletennis.undone.expedite',
    });
  });

  // Ruling 55's stale rule: another scorer started Expedite while the question was open. Nothing is left to ask, and a Start
  // would be a second start.
  it('closes when another scorer starts Expedite under it, and a Start then queues nothing', async () => {
    const { fakes, view } = await underWay();
    await press(view, 'expedite');
    expect(pad(view).sheet?.kind).toBe('expedite');
    fakes.scoring.addOtherScorerEvent('tabletennis.expedite.start', {});
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    act_(view, (actions) => actions.choose('start'));
    await flush();
    await wait();
    expect(await startsIn(fakes)).toHaveLength(1);
  });

  it('Back closes the question and records nothing', async () => {
    const { fakes, view } = await underWay();
    await press(view, 'expedite');
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view).sheet).toBeNull();
    expect(await startsIn(fakes)).toEqual([]);
  });
});

describe('Who is serving? (ruling 51): the answer is held, and the next point carries it', () => {
  it('is offered for a match another scorer started, and not for one this phone started', async () => {
    const { view } = await unanchored();
    expect(toolIds(pad(view).view)).toEqual(['setScore', 'expedite', 'serving', 'more']);
    const fakes = await rig();
    const mine = await started(fakes);
    expect(toolIds(pad(mine).view)).not.toContain('serving');
  });

  it('holds the side, says so on the last-tap line, and the next point carries it', async () => {
    const { fakes, view } = await unanchored();
    const append = vi.spyOn(fakes.scoring, 'append');
    await press(view, 'serving');
    expect(pad(view).sheet).toMatchObject({ kind: 'serving' });
    await choose(view, 'second');
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.tabletennis.held',
      vars: { side: 'L. Chen' },
    });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    ]);
    fakes.scoring.goOffline(false);
    await wait(60_000);
    const sent = append.mock.calls.map((call) => call[2]);
    expect(sent.at(-1)).toMatchObject({
      type: 'tabletennis.rally',
      payload: { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    });
  });

  it('is used by that point: the line and the tool are gone, and nothing is carried again', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    expect(toolIds(pad(view).view)).not.toContain('serving');
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    const sent = (await ledger(fakes, TABLE_TENNIS_UNANCHORED_SEED)).filter(
      (event) => event.type === 'tabletennis.rally',
    );
    expect(sent).toHaveLength(2);
    expect(sent[0].payload).toMatchObject({ wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT });
    expect(sent[1].payload).toMatchObject({ wonBy: AWAY_ENTRANT });
    expect(sent[1].payload).not.toHaveProperty('serving');
  });

  it('a second answer replaces the first', async () => {
    const { fakes, view } = await unanchored();
    fakes.scoring.goOffline(true);
    await answer(view, 'first');
    expect(pad(view).view.lastTap?.text).toMatchObject({ vars: { side: 'A. Sharma' } });
    await answer(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ vars: { side: 'L. Chen' } });
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    ]);
  });

  it('two points tapped before the pad redraws: only the first carries it', async () => {
    const { fakes, view } = await unanchored();
    fakes.scoring.goOffline(true);
    await answer(view, 'first');
    act(() => {
      pad(view).actions.tapHalf('first');
      pad(view).actions.tapHalf('second');
    });
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: HOME_ENTRANT },
      { wonBy: AWAY_ENTRANT, serving: null },
    ]);
  });

  it('a Set score the match refuses keeps the answer: nothing moved', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    await press(view, 'setScore');
    // Beyond the bound (31): refused on the line, the sheet stays, and nothing is queued.
    act_(view, (actions) => actions.saveScore('40', '2'));
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.invalidScore' });
    expect(queued(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([]);
    expect(await typesOf(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual(['core.start']);
    // The sheet leaves with the tap, refused or not (`useSaveScore`): the line says why.
    expect(pad(view).sheet).toBeNull();
    await wait();
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
  });

  it('is cleared by Undo of this phone’s last tap, so the next point carries nothing', async () => {
    const { fakes, view } = await unanchored();
    await press(view, 'more');
    await choose(view, 'timeout.first');
    await answer(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
    expect(pad(view).view.lastTap?.undo).toBe(true);
    act_(view, (actions) => actions.undo());
    await flush();
    await wait();
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    expect(pad(view).line).toBeNull();
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: null },
    ]);
  });

  it('an Undo that is refused leaves it: nothing of this phone’s was there to take back', async () => {
    const { view } = await unanchored();
    await answer(view, 'second');
    act_(view, (actions) => actions.undo());
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.nothingToUndo' });
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
  });

  it('is cleared when a Set score is queued: the score it was meant for has moved', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    await press(view, 'setScore');
    act_(view, (actions) => actions.saveScore('3', '2'));
    await flush();
    await wait();
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: null },
    ]);
  });

  it('a field that is not a whole number is refused on the line, and keeps the answer', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    await press(view, 'setScore');
    act_(view, (actions) => actions.saveScore('x', '2'));
    await flush();
    await wait();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.invalidScore' });
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual(['core.start']);
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
  });

  // Fix round 1 (I1): the answer is about the score it was made at. A point from another scorer that names no `serving`
  // leaves the pad needing an answer, but the score has moved: carried on, the engine would anchor at the wrong score.
  it('is dropped when another scorer scores without naming a server: the score has moved, and the tool asks again', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
    fakes.scoring.addOtherScorerEvent('tabletennis.rally', { wonBy: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(toolIds(pad(view).view)).toContain('serving');
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: AWAY_ENTRANT, serving: null },
    ]);
  });

  it('an answer made after that move is held at the new score and rides the next point', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    fakes.scoring.addOtherScorerEvent('tabletennis.rally', { wonBy: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    await answer(view, 'first');
    expect(pad(view).view.lastTap?.text).toMatchObject({ vars: { side: 'A. Sharma' } });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
    ]);
  });

  // The four questions, a second call: the answer's sheet button leaves the screen with the tap, so a half under it takes
  // the second touch of a double tap. It counts once, and the answer still waits for the point that is meant.
  it('a half tapped on the heels of the answer counts once, and the answer still waits', async () => {
    const { fakes, view } = await unanchored();
    fakes.scoring.goOffline(true);
    await press(view, 'serving');
    act_(view, (actions) => actions.choose('second'));
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([]);
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
    await wait();
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    ]);
  });

  it('is cleared when another scorer anchors the match, and not back if the anchor is lost again', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
    fakes.scoring.addOtherScorerEvent('tabletennis.rally', {
      wonBy: HOME_ENTRANT,
      serving: HOME_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    expect(toolIds(pad(view).view)).not.toContain('serving');
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    // Their point is taken back: the anchor is lost, and the tool asks again. The old answer is not what answers it.
    await wait(16_000);
    fakes.scoring.addOtherScorerEvent('core.void', { event_id: 'fake-event-2' });
    fakes.realtime.ping();
    await flush();
    expect(toolIds(pad(view).view)).toContain('serving');
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(rallies(fakes, TABLE_TENNIS_UNANCHORED_SEED)).toEqual([
      { wonBy: AWAY_ENTRANT, serving: null },
    ]);
  });

  it('is never held when the engine already names a server: the tool is not offered, and a stale press opens nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    expect(toolIds(pad(view).view)).not.toContain('serving');
    act_(view, (actions) => actions.tool('serving'));
    expect(pad(view).sheet).toBeNull();
    act_(view, (actions) => actions.choose('second'));
    await flush();
    expect(pad(view).line).toBeNull();
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
  });

  it('has one door: the sheet’s choice, and no action to answer without it', async () => {
    const { view } = await unanchored();
    expect(Object.keys(pad(view).actions)).not.toContain('pickServing');
  });

  it('is in memory only: the pad opened again asks again and holds nothing', async () => {
    const { fakes, view } = await unanchored();
    await answer(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.tabletennis.held' });
    view.unmount();
    const again = mount(fakes, TABLE_TENNIS_UNANCHORED_SEED);
    await flush();
    expect(toolIds(pad(again).view)).toContain('serving');
    expect(pad(again).view.lastTap?.text).not.toMatchObject({ key: 'scoring.tabletennis.held' });
  });

  it('the sheet closes if another scorer anchors the match while it is open', async () => {
    const { fakes, view } = await unanchored();
    await press(view, 'serving');
    expect(pad(view).sheet?.kind).toBe('serving');
    fakes.scoring.addOtherScorerEvent('tabletennis.rally', {
      wonBy: AWAY_ENTRANT,
      serving: HOME_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
  });
});

describe('13 returns (ruling 50)', () => {
  /** Singles, the first side served the first point and won it, and Expedite is in force: the engine names the server. */
  async function expedited() {
    const fakes = await rig();
    const view = await started(fakes);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    await press(view, 'expedite');
    await choose(view, 'start');
    return { fakes, view };
  }

  it('gives the point to the receiver named on the cell, and records the 13 returns', async () => {
    const { fakes, view } = await expedited();
    const cell = returnsCell(pad(view).view);
    expect(cell).toBeDefined();
    const receiver = cell?.id === 'returns.first' ? 'first' : 'second';
    // The receiver is the side without the serving plate (ITTF 2.15.2): never the server.
    const plates = pad(view).view.halves.map((half) => half.serving !== null);
    expect(plates[receiver === 'first' ? 0 : 1]).toBe(false);
    act_(view, (actions) => actions.tool(cell?.id ?? ''));
    await flush();
    const [last] = (await ledger(fakes)).slice(-1);
    expect(last).toMatchObject({
      type: 'tabletennis.rally',
      payload: { wonBy: receiver === 'first' ? HOME_ENTRANT : AWAY_ENTRANT, returns: 13 },
    });
    expect(last.payload).not.toHaveProperty('serving');
    expect(pad(view).flash).toEqual({ side: receiver, seq: 2 });
  });

  it('a second press inside the bounce window counts once, and the line says so', async () => {
    const { fakes, view } = await expedited();
    const id = returnsCell(pad(view).view)?.id ?? '';
    act(() => {
      pad(view).actions.tool(id);
      pad(view).actions.tool(id);
    });
    await flush();
    const returns = (await ledger(fakes)).filter(
      (event) => (event.payload as { returns?: number }).returns === 13,
    );
    expect(returns).toHaveLength(1);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    // The bounce flashed nothing: the one point flashed once (the point before it was the first flash).
    expect(pad(view).flash?.seq).toBe(2);
  });

  it('is a tap of its own: pressed on the heels of a point on the same half, it counts too', async () => {
    const { fakes, view } = await expedited();
    const server = pad(view).view.halves.find((half) => half.serving !== null)?.side ?? 'first';
    // The server wins a point and the serve changes sides: the cell now names the side that just scored.
    act_(view, (actions) => actions.tapHalf(server));
    await flush();
    const cell = returnsCell(pad(view).view);
    expect(cell?.id).toBe(`returns.${server}`);
    act_(view, (actions) => actions.tool(cell?.id ?? ''));
    await flush();
    const rallies = (await ledger(fakes)).filter((event) => event.type === 'tabletennis.rally');
    const winner = server === 'first' ? HOME_ENTRANT : AWAY_ENTRANT;
    expect(rallies.slice(-2).map((event) => event.payload)).toMatchObject([
      { wonBy: winner },
      { wonBy: winner, returns: 13 },
    ]);
  });

  it('a press on a cell drawn before the serve changed credits nobody: the side now serving cannot be given it', async () => {
    const { fakes, view } = await expedited();
    const stale = returnsCell(pad(view).view)?.id ?? '';
    act_(view, (actions) => actions.tool(stale));
    await flush();
    await wait();
    // The cell now offers the other side; the old one's press lands late.
    expect(returnsCell(pad(view).view)?.id).not.toBe(stale);
    act_(view, (actions) => actions.tool(stale));
    await flush();
    const returns = (await ledger(fakes)).filter(
      (event) => (event.payload as { returns?: number }).returns === 13,
    );
    expect(returns).toHaveLength(1);
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notNow' });
  });

  it('is undone like any point', async () => {
    const { fakes, view } = await expedited();
    act_(view, (actions) => actions.tool(returnsCell(pad(view).view)?.id ?? ''));
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect((await ledger(fakes)).at(-1)?.type).toBe('core.void');
    expect(pad(view).view.lastTap?.text).toMatchObject({
      key: 'scoring.tabletennis.undone.returns',
    });
  });
});

describe('the reconnect question (owner ruling 43)', () => {
  /** This phone scored offline, another scorer scored meanwhile, and the phone is back: the pad asks before it sends. */
  async function asked() {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    fakes.scoring.addOtherScorerEvent('tabletennis.rally', { wonBy: AWAY_ENTRANT });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    return { fakes, view };
  }

  it('asks over the pad with the counts, and holds the taps back', async () => {
    const { fakes, view } = await asked();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { foreign: 1, queued: 1 } });
    expect(await typesOf(fakes)).toEqual(['core.start', 'tabletennis.rally']);
  });

  it('Send my taps sends them on the ledger as it stands, and the question goes', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act_(view, (actions) => actions.sendTaps());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start', 'tabletennis.rally', 'tabletennis.rally']);
  });

  it('Discard asks again, and its confirm deletes the taps: nothing of this phone’s is sent', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act_(view, (actions) => actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
    await wait(300);
    act_(view, (actions) => actions.confirmDiscard());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(queued(fakes, TABLE_TENNIS_SINGLES_SEED)).toEqual([]);
    expect(await typesOf(fakes)).toEqual(['core.start', 'tabletennis.rally']);
  });
});

describe('a link that dies', () => {
  it('closes the sheet open, and the bad-link card shows', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'more');
    expect(pad(view).sheet?.kind).toBe('more');
    fakes.scoring.revoke();
    await act(async () => {
      pad(view).actions.tapHalf('first');
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(pad(view).view.card).toEqual({ kind: 'linkInvalid' });
    expect(pad(view).sheet).toBeNull();
  });
});

describe('the tools that are not ours', () => {
  it('an id nobody offers opens nothing and records nothing', async () => {
    const fakes = await rig();
    const append = vi.spyOn(fakes.scoring, 'append');
    const view = await started(fakes);
    const sent = append.mock.calls.length;
    act_(view, (actions) => actions.tool('sanction.first'));
    act_(view, (actions) => actions.tool('returns.third'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(append.mock.calls.length).toBe(sent);
  });

  it('a tool pressed on the heels of a sheet’s recording opens nothing: Counted once', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'more');
    act_(view, (actions) => actions.choose('timeout.first'));
    act_(view, (actions) => actions.tool('more'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });
});
