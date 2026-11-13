import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  DOUBLES_NOAD_CFG,
  doublesSeed,
  gameEvents,
  HOME_ENTRANT,
  pointEvent,
  singlesSeed,
  START,
  TENNIS_DOUBLES_NOAD_SEED,
  TENNIS_FAST4_SEED,
  TENNIS_STARTED_SEED,
  TENNIS_TOUR_SEED,
} from '@/services/fakeTennisPad';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The tennis match hook (S2-7 Task 9): what the pad screen is drawn from, over the real runner, hub, queue store, reducer and
// fold, and a fake server that judges with the engine alone. Copy is keys here (the screen draws the words); every
// expectation is a literal from the spec (§4, rulings 216-221, 229).

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

async function rig(seed: FakeMatchSeed = TENNIS_TOUR_SEED): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'tennis');
  return fakes;
}

function mount(fakes: FakePorts, seed: FakeMatchSeed = TENNIS_TOUR_SEED) {
  return renderHook(() => useTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
}

type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useTennisMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const act_ = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

/** The taps this phone has queued and the server has not yet taken, as the queue file holds them. */
function queued(fakes: FakePorts, seed: FakeMatchSeed) {
  const text = fakes.queueFiles.files.get(`${seed.fixtureId}.json`);
  if (text === undefined) return [];
  const file = JSON.parse(text) as { pending: { type: string; payload: unknown }[] };
  return file.pending.map(({ type, payload }) => ({ type, payload }));
}

const queuedOf = (fakes: FakePorts, seed: FakeMatchSeed, type: string) =>
  queued(fakes, seed)
    .filter((tap) => tap.type === type)
    .map((tap) => tap.payload as Record<string, unknown>);

/** The ids offered by the step on screen: a sheet that has none is a failed test, not a type to narrow. */
const optionIds = (sheet: unknown) =>
  (sheet as { sheet: { options: { id: string }[] } }).sheet.options.map((option) => option.id);

const toolIds = (view: PadView<string>) => view.tools.map((tool) => tool.id);

/** The pad of a match another scorer started, nothing queued yet; offline so the queue shows this phone's taps. */
async function opened(seed: FakeMatchSeed = TENNIS_STARTED_SEED) {
  const fakes = await rig(seed);
  const view = mount(fakes, seed);
  await flush();
  fakes.scoring.goOffline(true);
  return { fakes, view };
}

async function press(view: Match, id: string) {
  act_(view, (actions) => actions.tool(id));
  await wait(300);
}

async function choose(view: Match, id: string) {
  act_(view, (actions) => actions.choose(id));
  await flush();
  await wait(300);
}

async function save(view: Match, first: string, second: string) {
  act_(view, (actions) => actions.saveScore(first, second));
  await flush();
  await wait(300);
}

const TOSS_AWAY: FakeSeedEvent = { type: 'tennis.toss', payload: { serving: AWAY_ENTRANT } };

const summary = (home: number, away: number): FakeSeedEvent => ({
  type: 'tennis.set_summary',
  payload: { home, away },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Start screen and the first point', () => {
  it('Start match waits for the pick, queues the toss BEFORE the start, and the first point carries the side only (ruling 233)', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    expect(pad(view).view.start?.needsToss).toBe(true);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.start());
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    expect(pad(view).toss).toBe('second');
    act_(view, (actions) => actions.start());
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([
      { type: 'tennis.toss', payload: { serving: AWAY_ENTRANT } },
      { type: 'core.start', payload: {} },
    ]);
    expect(pad(view).view.halves[1].serving).not.toBeNull();
    expect(pad(view).view.halves[0].serving).toBeNull();
    await wait();
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(queuedOf(fakes, TENNIS_TOUR_SEED, 'tennis.point')).toEqual([{ by: AWAY_ENTRANT }]);
    expect(pad(view).view.halves[1].value).toBe('15');
  });

  it('the pick for home queues a toss naming home (a toss is recorded for either side)', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.pickServer('first'));
    await flush();
    act_(view, (actions) => actions.start());
    await flush();
    expect(queuedOf(fakes, TENNIS_TOUR_SEED, 'tennis.toss')).toEqual([{ serving: HOME_ENTRANT }]);
  });

  it('the toss and the start reach the server in that order and the match stands started with the toss held', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
    expect(pad(view).view.start).toBeNull();
    expect(pad(view).view.halves[1].serving).not.toBeNull();
  });

  it('a second press of Start match, inside the window and after the screen has left, sends one toss and one start', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    const stale = pad(view).actions;
    act(() => {
      stale.start();
      stale.start();
    });
    await flush();
    await wait(1_000);
    act(() => stale.start());
    await flush();
    expect(queuedOf(fakes, TENNIS_TOUR_SEED, 'tennis.toss')).toHaveLength(1);
    expect(queuedOf(fakes, TENNIS_TOUR_SEED, 'core.start')).toHaveLength(1);
  });

  it('a match another scorer started without a toss keeps working: no question, no toss sent, home serves', async () => {
    const { fakes, view } = await opened();
    expect(pad(view).view.start).toBeNull();
    expect(pad(view).view.halves[0].serving).not.toBeNull();
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(queued(fakes, TENNIS_STARTED_SEED).map((tap) => tap.type)).toEqual(['tennis.point']);
  });

  it('a toss already held at the Start screen is not asked again: Start match sends the start alone', async () => {
    const seed = { ...TENNIS_TOUR_SEED, events: [TOSS_AWAY] };
    const fakes = await rig(seed);
    const view = mount(fakes, seed);
    await flush();
    expect(pad(view).view.start?.needsToss).toBe(false);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.start());
    await flush();
    expect(queued(fakes, seed)).toEqual([{ type: 'core.start', payload: {} }]);
  });

  it('another scorer started while this phone was on the Start screen: the toss is refused, nothing re-seats the match', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    const stale = pad(view).actions;
    fakes.scoring.goOffline(true);
    fakes.scoring.addConsoleEvent('core.start', {});
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    act(() => stale.start());
    await flush();
    expect(queuedOf(fakes, TENNIS_TOUR_SEED, 'tennis.toss')).toEqual([]);
    expect(
      readRecord(fakes.record).filter((line) => line.event === 'scoring.toss-refused'),
    ).toEqual([{ level: 'warn', event: 'scoring.toss-refused', fields: {} }]);
  });

  it('Undo of the start takes the toss with it once the start’s void has landed, so the screen asks who serves first again', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    // The start's fate is unknown while offline, so its void waits for the answer, and the toss is not voided before it.
    expect(queued(fakes, TENNIS_TOUR_SEED).map((tap) => tap.type)).toEqual([
      'tennis.toss',
      'core.void',
    ]);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await wait(5_000);
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
    expect(pad(view).view.start?.needsToss).toBe(true);
    expect(pad(view).toss).toBeNull();
    const events = await fakes.scoring.events(LINK, TENNIS_TOUR_SEED.fixtureId, 0);
    // The start never reached the server (offline), so only the toss did, and it was voided: nothing of the match stands.
    expect(Array.isArray(events) ? events.map((event) => [event.type, event.voids]) : null).toEqual(
      [
        ['tennis.toss', null],
        ['core.void', 'fake-event-1'],
      ],
    );
  });

  it('Undo of a start the server holds, with this phone’s toss, voids the start and then the toss', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED).map((tap) => tap.type)).toEqual([
      'core.void',
      'core.void',
    ]);
    expect(pad(view).view.start?.needsToss).toBe(true);
  });

  it('Undo of the start leaves a toss that is another scorer’s alone: the start screen does not ask again', async () => {
    const seed = { ...TENNIS_TOUR_SEED, events: [TOSS_AWAY] };
    const fakes = await rig(seed);
    const view = mount(fakes, seed);
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(queued(fakes, seed).map((tap) => tap.type)).toEqual(['core.void']);
    expect(pad(view).view.start?.needsToss).toBe(false);
  });

  it('an Undo of a point is no Undo of the start: when the organiser later voids the start, this phone’s toss is left held and not voided', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(2_000);
    act_(view, (actions) => actions.undo());
    await wait(2_000);
    fakes.scoring.addConsoleEvent('core.void', { event_id: 'fake-event-2' });
    fakes.realtime.ping();
    await wait(2_000);
    expect(pad(view).view.start?.needsToss).toBe(false);
    expect(pad(view).view.start?.sides.map((side) => side.plate)).toEqual([
      null,
      { key: 'scoring.tennis.serving' },
    ]);
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
  });

  it('the Undo owed to a toss is paid once: a second round’s toss is not voided when the organiser later voids its start', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    act_(view, (actions) => actions.undo());
    await wait(5_000);
    expect(pad(view).view.start?.needsToss).toBe(true);
    act_(view, (actions) => actions.pickServer('first'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    // The ledger: toss, start, void, void, toss, start (seq 1-6); the organiser voids the second start.
    fakes.scoring.addConsoleEvent('core.void', { event_id: 'fake-event-6' });
    fakes.realtime.ping();
    await wait(2_000);
    expect(pad(view).view.start?.needsToss).toBe(false);
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
  });

  it('a refused Undo of the start owes nothing: a later void of the start by another scorer leaves this phone’s toss alone', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await wait(2_000);
    const stale = pad(view).actions;
    // Another scorer's point lands while the Undo button still says Undo of the start: the Undo is refused.
    const other = fakes.scoring.addOtherScorerEvent('tennis.point', { by: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    act(() => stale.undo());
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
    fakes.scoring.addConsoleEvent('core.void', { event_id: other.id });
    fakes.scoring.addConsoleEvent('core.void', { event_id: 'fake-event-2' });
    fakes.realtime.ping();
    await wait(2_000);
    expect(pad(view).view.start?.needsToss).toBe(false);
    expect(queued(fakes, TENNIS_TOUR_SEED)).toEqual([]);
  });

  it('an Undo of a start whose answer was lost pays the toss at once, behind the start’s void: nothing stays owed for a later void by the organiser', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    // The toss lands and is answered; the start lands and its answer is lost, so it is unresolved.
    const append = fakes.scoring.append;
    let sent = 0;
    fakes.scoring.append = (...args) => {
      sent += 1;
      if (sent === 2) fakes.scoring.dropNextAnswer();
      return append(...args);
    };
    act_(view, (actions) => actions.start());
    await flush();
    await wait(300);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED).map((tap) => tap.type)).toEqual([
      'core.start',
      'core.void',
      'core.void',
    ]);
    expect(pad(view).view.start?.needsToss).toBe(true);
  });

  it('a process death between the toss and the start loses neither: both are in the queue file and come back on a fresh mount', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.pickServer('second'));
    await flush();
    act_(view, (actions) => actions.start());
    await flush();
    view.unmount();
    const again = mount(fakes);
    await flush();
    expect(queued(fakes, TENNIS_TOUR_SEED).map((tap) => tap.type)).toEqual([
      'tennis.toss',
      'core.start',
    ]);
    expect(pad(again).view.start).toBeNull();
    expect(pad(again).view.halves[1].serving).not.toBeNull();
  });

  it('offers Violation, Break, Award game and Set score, in that order, once the match is on', async () => {
    const { view } = await opened();
    expect(toolIds(pad(view).view)).toEqual(['violation', 'break', 'award', 'setScore']);
  });

  it('the half’s point is one point sent, a second tap past the window another', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.point')).toEqual([
      { by: HOME_ENTRANT },
      { by: HOME_ENTRANT },
    ]);
    expect(pad(view).view.halves[0].value).toBe('30');
  });
});

describe('Violation (ruling 218)', () => {
  it('asks the side, the level, then a confirm, and sends the sanction with no person for a singles side', async () => {
    const { fakes, view } = await opened();
    await press(view, 'violation');
    expect(pad(view).sheet).toMatchObject({ kind: 'side' });
    expect(optionIds(pad(view).sheet)).toEqual(['first', 'second']);
    await choose(view, 'second');
    expect(pad(view).sheet?.kind).toBe('violation');
    expect(optionIds(pad(view).sheet)).toEqual(['warning', 'point_penalty', 'game_penalty']);
    await choose(view, 'point_penalty');
    expect(optionIds(pad(view).sheet)).toEqual(['confirm']);
    await choose(view, 'confirm');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.sanction')).toEqual([
      { by: AWAY_ENTRANT, level: 'point_penalty' },
    ]);
  });

  it('a point penalty says what to tap next in the last-tap line; a warning says nothing more', async () => {
    const { view } = await opened();
    await press(view, 'violation');
    await choose(view, 'second');
    await choose(view, 'point_penalty');
    await choose(view, 'confirm');
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.tennis.violation.done.point',
      vars: { other: 'Ana Ruiz' },
    });
    await press(view, 'violation');
    await choose(view, 'first');
    await choose(view, 'warning');
    await choose(view, 'confirm');
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: { level: { key: 'scoring.tennis.level.warning' }, person: 'Ana Ruiz' },
    });
  });

  it('a second touch within the bounce window of a step shown is quiet: the level is not chosen by a double tap', async () => {
    const { view } = await opened();
    await press(view, 'violation');
    act_(view, (actions) => actions.choose('first'));
    await flush();
    expect(optionIds(pad(view).sheet)).toContain('warning');
    act_(view, (actions) => actions.choose('warning'));
    await flush();
    expect(optionIds(pad(view).sheet)).toContain('warning');
    await wait(300);
    await choose(view, 'warning');
    expect(optionIds(pad(view).sheet)).toContain('confirm');
  });

  it('a game penalty says Award game for the other side, and in a tie-break asks the organiser', async () => {
    const { view } = await opened();
    await press(view, 'violation');
    await choose(view, 'first');
    await choose(view, 'game_penalty');
    await choose(view, 'confirm');
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.tennis.violation.done.game',
      vars: { other: 'Bea Lund' },
    });
  });

  it('doubles ask the player, from the side’s sheet, and send the person with the sanction', async () => {
    const { fakes, view } = await opened(doublesSeed({ events: [START] }));
    await press(view, 'violation');
    await choose(view, 'second');
    await choose(view, 'warning');
    expect(pad(view).sheet?.kind).toBe('violation');
    expect(optionIds(pad(view).sheet)).toEqual([`${AWAY_ENTRANT}-p1`, `${AWAY_ENTRANT}-p2`]);
    await choose(view, `${AWAY_ENTRANT}-p2`);
    await choose(view, 'confirm');
    expect(queuedOf(fakes, doublesSeed({ events: [START] }), 'tennis.sanction')).toEqual([
      { by: AWAY_ENTRANT, level: 'warning', person: `${AWAY_ENTRANT}-p2` },
    ]);
  });

  it('never offers the organiser’s default', async () => {
    const { view } = await opened();
    await press(view, 'violation');
    await choose(view, 'first');
    expect(optionIds(pad(view).sheet)).not.toContain('default');
  });

  it('a confirm tapped twice records once', async () => {
    const { fakes, view } = await opened();
    await press(view, 'violation');
    await choose(view, 'first');
    await choose(view, 'warning');
    const actions = pad(view).actions;
    act(() => {
      actions.choose('confirm');
      actions.choose('confirm');
    });
    await flush();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.sanction')).toHaveLength(1);
  });

  it('a press of Violation tapped twice opens one sheet and one step', async () => {
    const { view } = await opened();
    act(() => {
      pad(view).actions.tool('violation');
      pad(view).actions.tool('violation');
    });
    expect(pad(view).sheet?.kind).toBe('side');
  });
});

describe('Back through the steps', () => {
  it('steps back one step, from the first step of Violation to its side, and from the side it closes', async () => {
    const { fakes, view } = await opened(doublesSeed({ events: [START] }));
    await press(view, 'violation');
    await choose(view, 'first');
    await choose(view, 'warning');
    await choose(view, `${HOME_ENTRANT}-p1`);
    expect(optionIds(pad(view).sheet)).toEqual(['confirm']);
    const backOnce = async () => {
      let handled = false;
      act(() => {
        handled = fakes.back.press();
      });
      expect(handled).toBe(true);
      await wait(300);
    };
    await backOnce();
    expect(optionIds(pad(view).sheet)).toEqual([`${HOME_ENTRANT}-p1`, `${HOME_ENTRANT}-p2`]);
    await backOnce();
    expect(optionIds(pad(view).sheet)).toEqual(['warning', 'point_penalty', 'game_penalty']);
    await backOnce();
    expect(pad(view).sheet?.kind).toBe('side');
    await backOnce();
    expect(pad(view).sheet).toBeNull();
    expect(
      queued(fakes, TENNIS_STARTED_SEED).filter((tap) => tap.type === 'tennis.sanction'),
    ).toEqual([]);
  });

  it('Award’s and Break’s Back go to the step before, and the first step closes', async () => {
    const { fakes, view } = await opened();
    const back = async () => {
      act(() => void fakes.back.press());
      await wait(300);
    };
    await press(view, 'award');
    await choose(view, 'first');
    expect(optionIds(pad(view).sheet)).toEqual(['confirm']);
    await back();
    expect(optionIds(pad(view).sheet)).toEqual(['first', 'second']);
    await back();
    expect(pad(view).sheet).toBeNull();
    await press(view, 'break');
    await choose(view, 'heat');
    await back();
    expect(optionIds(pad(view).sheet)).toEqual(['medical', 'toilet', 'heat', 'other']);
    await back();
    expect(pad(view).sheet).toBeNull();
  });
});

describe('Award game (ruling 219)', () => {
  it('asks the side, then a confirm, and sends the award; the confirm tapped twice records once', async () => {
    const { fakes, view } = await opened();
    await press(view, 'award');
    await choose(view, 'second');
    expect(optionIds(pad(view).sheet)).toEqual(['confirm']);
    const actions = pad(view).actions;
    act(() => {
      actions.choose('confirm');
      actions.choose('confirm');
    });
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.game.award')).toEqual([
      { winner: AWAY_ENTRANT },
    ]);
  });

  it('a choice the step does not offer moves nothing and sends nothing', async () => {
    const { fakes, view } = await opened();
    await press(view, 'award');
    await choose(view, 'bogus');
    expect(optionIds(pad(view).sheet)).toEqual(['first', 'second']);
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
  });

  it('is disabled in a tie-break, its cell kept', async () => {
    const sixAll = singlesSeed({
      fixtureId: 'fake-tn-sixall',
      events: [
        START,
        ...[...'HAHAHAHAHAHA'].flatMap((c) => gameEvents(c === 'H' ? 'first' : 'second')),
      ],
    });
    const { view } = await opened(sixAll);
    const award = pad(view).view.tools.find((tool) => tool.id === 'award');
    expect(award?.enabled).toBe(false);
  });
});

describe('Break (ruling 220)', () => {
  it('sends the kind and the side, or the kind alone for Both / none, and never a person or a duration', async () => {
    const { fakes, view } = await opened();
    await press(view, 'break');
    await choose(view, 'medical');
    expect(optionIds(pad(view).sheet)).toEqual(['first', 'second', 'both']);
    await choose(view, 'first');
    await press(view, 'break');
    await choose(view, 'heat');
    await choose(view, 'both');
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.interruption')).toEqual([
      { kind: 'medical', by: HOME_ENTRANT },
      { kind: 'heat' },
    ]);
  });
});

describe('Set score (ruling 221)', () => {
  it('is offered before a set’s first point and takes the games: 6–4 asks no tie-break and sends no tb', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', set: 1, stage: 'games' });
    await save(view, '6', '4');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.set_summary')).toEqual([
      { home: 6, away: 4 },
    ]);
  });

  it('7–6 asks the tie-break’s points, then sends them as tb, and nothing is sent between', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    await save(view, '7', '6');
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', stage: 'tiebreak' });
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
    await save(view, '7', '5');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.set_summary')).toEqual([
      { home: 7, away: 6, tb: { home: 7, away: 5 } },
    ]);
  });

  it('Back from the tie-break’s points returns to the games, then closes', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    await save(view, '7', '6');
    act(() => void fakes.back.press());
    await wait(300);
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', stage: 'games' });
    act(() => void fakes.back.press());
    expect(pad(view).sheet).toBeNull();
  });

  it('a match tie-break decider is entered as its points, with no tie-break stage', async () => {
    const seed = doublesSeed({
      fixtureId: 'fake-tn-mtb',
      cfg: DOUBLES_NOAD_CFG,
      events: [START, summary(6, 4), summary(4, 6)],
    });
    const { fakes, view } = await opened(seed);
    expect(toolIds(pad(view).view)).toContain('setScore');
    await press(view, 'setScore');
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', set: 3, stage: 'games' });
    await save(view, '10', '7');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, seed, 'tennis.set_summary')).toEqual([{ home: 10, away: 7 }]);
  });

  it('an unreachable score gives one refusal line and sends nothing', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    await save(view, '9', '0');
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.invalidScore' });
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
  });

  it('a field that is not a whole number gives the same one line', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    await save(view, 'six', '4');
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.invalidScore' });
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
  });

  it('Save pressed twice records once', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    const actions = pad(view).actions;
    act(() => {
      actions.saveScore('6', '3');
      actions.saveScore('6', '3');
    });
    await flush();
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.set_summary')).toHaveLength(1);
  });

  it('stays, disabled, once a point stands, and its sheet closes with it', async () => {
    const { fakes, view } = await opened();
    await press(view, 'setScore');
    expect(pad(view).sheet?.kind).toBe('setScore');
    fakes.scoring.goOffline(false);
    fakes.scoring.addOtherScorerEvent('tennis.point', { by: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    // Set score is removed once the match has a point (ruling 241).
    expect(pad(view).view.tools.find((tool) => tool.id === 'setScore')).toBeUndefined();
  });
});

describe('a co-scorer’s point lands while a sheet is open (Review Focus 2)', () => {
  const land = async (fakes: FakePorts) => {
    fakes.scoring.goOffline(false);
    fakes.scoring.addOtherScorerEvent('tennis.point', { by: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    fakes.scoring.goOffline(true);
  };
  const lines = (fakes: FakePorts) =>
    readRecord(fakes.record).filter((line) => line.event === 'scoring.sheet-dropped');

  it.each([
    ['Violation', 'violation', ['first', 'warning']],
    ['Award game', 'award', ['first']],
    ['Break', 'break', ['heat']],
    ['Set score', 'setScore', []],
  ] as const)(
    '%s closes with one line, in the record too, and sends nothing',
    async (_n, tool, picks) => {
      const { fakes, view } = await opened();
      await press(view, tool);
      for (const id of picks) await choose(view, id);
      expect(pad(view).sheet).not.toBeNull();
      await land(fakes);
      expect(pad(view).sheet).toBeNull();
      expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
      expect(lines(fakes)).toHaveLength(1);
      expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
    },
  );

  it('a press that reaches the closure drawn before the point sends nothing', async () => {
    const { fakes, view } = await opened();
    await press(view, 'award');
    await choose(view, 'first');
    const stale = pad(view).actions;
    await land(fakes);
    act(() => stale.choose('confirm'));
    await flush();
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
    expect(queuedOf(fakes, TENNIS_STARTED_SEED, 'tennis.game.award')).toEqual([]);
  });

  it('a sheet opened after the point is not closed by it (it recorded the count it opened at)', async () => {
    const { fakes, view } = await opened();
    await land(fakes);
    await press(view, 'violation');
    await wait(1_000);
    expect(pad(view).sheet?.kind).toBe('side');
    await choose(view, 'first');
    expect(pad(view).sheet?.kind).toBe('violation');
  });

  it('Match details and History stay open under another scorer’s point: they are views, not answers', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.details());
    expect(pad(view).sheet?.kind).toBe('details');
    await land(fakes);
    expect(pad(view).sheet?.kind).toBe('details');
    act_(view, (actions) => actions.history());
    await land(fakes);
    expect(pad(view).sheet?.kind).toBe('history');
    expect(lines(fakes)).toHaveLength(0);
  });
});

describe('the people sheets read the teams again (ruling 181)', () => {
  const asked = async (tool: string) => {
    const { fakes, view } = await opened();
    await wait(16_000);
    fakes.scoring.goOffline(false);
    const read = vi.spyOn(fakes.scoring, 'bootstrap');
    await press(view, tool);
    await flush();
    return read;
  };

  it('Violation asks the server for the bootstrap again', async () => {
    expect(await asked('violation')).toHaveBeenCalled();
  });

  it('Break asks too', async () => {
    expect(await asked('break')).toHaveBeenCalled();
  });

  it('Award game and Set score list no people and ask nothing', async () => {
    expect(await asked('award')).not.toHaveBeenCalled();
    expect(await asked('setScore')).not.toHaveBeenCalled();
  });
});

describe('Match details, History, interruptions (the four questions)', () => {
  it('Match details and History open and close, and Back closes a sheet and records nothing', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.details());
    expect(pad(view).sheet?.kind).toBe('details');
    await wait(1_000);
    act_(view, (actions) => actions.dismiss());
    expect(pad(view).sheet).toBeNull();
    act_(view, (actions) => actions.history());
    expect(pad(view).sheet?.kind).toBe('history');
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view).sheet).toBeNull();
    expect(queued(fakes, TENNIS_STARTED_SEED)).toEqual([]);
  });

  it('History is the fold’s, newest first', async () => {
    const { view } = await opened();
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    act_(view, (actions) => actions.history());
    const sheet = pad(view).sheet;
    expect(sheet?.kind).toBe('history');
    if (sheet?.kind !== 'history') return;
    expect(sheet.groups[0]?.rows[0]?.score).toBe('15–0');
    expect(sheet.groups[0]?.rows[0]?.sending).toBe(true);
  });

  it('a sheet left open across background and foreground stays open', async () => {
    const { fakes, view } = await opened();
    await press(view, 'violation');
    await choose(view, 'first');
    expect(pad(view).sheet?.kind).toBe('violation');
    act(() => fakes.foreground.leave());
    await wait(1_000);
    act(() => fakes.foreground.fire());
    await flush();
    expect(pad(view).sheet?.kind).toBe('violation');
  });

  it('after a restart no sheet comes back', async () => {
    const { fakes, view } = await opened();
    await press(view, 'award');
    expect(pad(view).sheet?.kind).toBe('award');
    view.unmount();
    const again = mount(fakes, TENNIS_STARTED_SEED);
    await flush();
    expect(pad(again).sheet).toBeNull();
  });

  it('Undo of a point not yet sent queues its void behind it, and the score is as before', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(pad(view).view.halves[1].value).toBe('0');
    expect(queued(fakes, TENNIS_STARTED_SEED).map((tap) => tap.type)).toEqual([
      'tennis.point',
      'core.void',
    ]);
  });

  it('Undo of a point the server holds sends a void, and says what it took back', async () => {
    const fakes = await rig(TENNIS_STARTED_SEED);
    const view = mount(fakes, TENNIS_STARTED_SEED);
    await flush();
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(2_000);
    expect(pad(view).view.halves[1].value).toBe('15');
    act_(view, (actions) => actions.undo());
    await wait(2_000);
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.tennis.undone.point',
      vars: { side: 'Bea Lund' },
    });
    expect(pad(view).view.halves[1].value).toBe('0');
  });

  it('every sheet is for another config too: Fast4 and a doubles no-ad match open the same four tools', async () => {
    for (const seed of [TENNIS_FAST4_SEED, TENNIS_DOUBLES_NOAD_SEED]) {
      const started = { ...seed, events: [START] };
      const { view } = await opened(started);
      expect(toolIds(pad(view).view)).toEqual(['violation', 'break', 'award', 'setScore']);
      view.unmount();
    }
  });

  it('an ending the organiser recorded closes every sheet and leaves no tool', async () => {
    const { fakes, view } = await opened({
      ...TENNIS_STARTED_SEED,
      events: [START, pointEvent('first')],
    });
    await press(view, 'award');
    expect(pad(view).sheet?.kind).toBe('award');
    fakes.scoring.goOffline(false);
    fakes.scoring.addConsoleEvent('core.forfeit', { by: AWAY_ENTRANT, reason: 'retired' });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(toolIds(pad(view).view)).toEqual([]);
  });
});
