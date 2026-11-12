import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  START,
  TENNIS_STARTED_SEED,
  gameEvents,
  pointEvent,
  singlesSeed,
} from '@/services/fakeTennisPad';
import { useTennisMatch } from '@/hooks/useTennisMatch';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// S2-7 ruling 234 (Task 17): the point details, over the real runner, hub, queue store, reducer and fold, and a fake server
// that judges with the engine alone. The switch is off by default and kept per match; on, a point is held unsent for the
// web's 10 s while its chips stand in the tools' place, and a chip tags it (`meta.kind`). Every expected payload is written
// out from the engine's schema and the seed's ids (home serves first: no toss in the seed). The four questions: a second
// chip tap, a chip after the hold ran out, process death while held, another scorer's point while held.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const SEED = TENNIS_STARTED_SEED;
const HOME_PLAYER = 'ent-home-p1';
const KEY = `scoring.tennis.details.${SEED.fixtureId}`;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function rig(seed: FakeMatchSeed = SEED): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'tennis');
  return fakes;
}

const mount = (fakes: FakePorts, seed: FakeMatchSeed = SEED) =>
  renderHook(() => useTennisMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });

type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useTennisMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const act_ = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

const toolIds = (view: PadView<string>) => view.tools.map((tool) => tool.id);
const TOOLS = ['violation', 'break', 'award', 'setScore'];

/** The points the server holds, in order. */
async function serverPoints(fakes: FakePorts) {
  const events = await fakes.scoring.events(LINK, SEED.fixtureId, 0);
  if (!Array.isArray(events)) throw new Error('the server did not answer');
  return events.filter((event) => event.type === 'tennis.point').map((event) => event.payload);
}

/** The pad opened, online, with the switch on. */
async function switchedOn(seed: FakeMatchSeed = SEED) {
  const fakes = await rig(seed);
  const view = mount(fakes, seed);
  await flush();
  act_(view, (actions) => actions.togglePointDetails());
  await flush();
  return { fakes, view };
}

async function point(view: Match, side: 'first' | 'second') {
  act_(view, (actions) => actions.tapHalf(side));
  await flush();
}

async function chip(view: Match, id: string) {
  act_(view, (actions) => actions.tool(id));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Point details switch', () => {
  it('is off by default: a point is the side alone, sent at once, and the tools stay', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    expect(pad(view).pointDetails).toBe(false);
    await point(view, 'first');
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT }]);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
  });

  it('is kept for the match: on is written, and a new pad reads it on', async () => {
    const { fakes, view } = await switchedOn();
    expect(pad(view).pointDetails).toBe(true);
    expect(fakes.kv.entries.get(KEY)).toBe('on');
    view.unmount();
    const again = mount(fakes);
    await flush();
    expect(pad(again).pointDetails).toBe(true);
  });

  it('turned off, keeps nothing, and the next point is plain again', async () => {
    const { fakes, view } = await switchedOn();
    act_(view, (actions) => actions.togglePointDetails());
    await flush();
    expect(pad(view).pointDetails).toBe(false);
    expect(fakes.kv.entries.has(KEY)).toBe(false);
    await point(view, 'first');
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT }]);
  });

  it('turned off while a point is held, lets it go at once, untagged, and the tools come back', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    act_(view, (actions) => actions.togglePointDetails());
    await flush();
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT, server: HOME_PLAYER }]);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
  });

  it('a read that lands after the scorer switched it on is late news: the switch stays on', async () => {
    const fakes = await rig();
    let answer: (value: string | null) => void = () => undefined;
    const get = fakes.kv.get;
    fakes.kv.get = (key) =>
      key === KEY ? new Promise<string | null>((resolve) => (answer = resolve)) : get(key);
    const view = mount(fakes);
    await flush();
    act_(view, (actions) => actions.togglePointDetails());
    await flush();
    await act(async () => answer(null));
    await flush();
    expect(pad(view).pointDetails).toBe(true);
  });

  it('a refused save says so in the record, and the switch still shows what was chosen', async () => {
    const fakes = await rig();
    const view = mount(fakes);
    await flush();
    fakes.kv.set = () => Promise.reject(new Error('locked'));
    act_(view, (actions) => actions.togglePointDetails());
    await flush();
    expect(pad(view).pointDetails).toBe(true);
    expect(readRecord(fakes.record).map((line) => line.event)).toContain(
      'scoring.point-details-not-saved',
    );
  });
});

describe('a point held for its chips', () => {
  it('on the server’s point: Ace, Winner and Error in the tools’ place; nothing sent while it is held', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    expect(toolIds(pad(view).view)).toEqual(['chip.ace', 'chip.winner', 'chip.ue']);
    expect(pad(view).view.toolSlots).toBeUndefined();
    expect(pad(view).view.halves[0].value).toBe('15');
    await wait(9_000);
    expect(await serverPoints(fakes)).toEqual([]);
  });

  it('on the receiver’s point: Double fault, Winner and Error', async () => {
    const { view } = await switchedOn();
    await point(view, 'second');
    expect(toolIds(pad(view).view)).toEqual(['chip.double_fault', 'chip.winner', 'chip.ue']);
  });

  it('a chip tags it and sends it at once, and the tools come back', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    await wait(300);
    await chip(view, 'chip.ace');
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([
      { by: HOME_ENTRANT, server: HOME_PLAYER, meta: { kind: 'ace' } },
    ]);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
      'scoring.point-detail-dropped',
    );
  });

  it('a point the match refuses (it is decided) leaves the held point’s chips as they were', async () => {
    const matchPoint = singlesSeed({
      fixtureId: 'fake-tn-match-point',
      events: [
        START,
        ...gameEvents('first', 11),
        pointEvent('first'),
        pointEvent('first'),
        pointEvent('first'),
      ],
    });
    const { view } = await switchedOn(matchPoint);
    // Game 12 of the match: away serves it, so home's point may be a double fault.
    await point(view, 'first');
    expect(toolIds(pad(view).view)).toEqual(['chip.double_fault', 'chip.winner', 'chip.ue']);
    await wait(300);
    // A second home point, refused: had it made chips, they would be the server's own (the decided view names home).
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(toolIds(pad(view).view)).toEqual(['chip.double_fault', 'chip.winner', 'chip.ue']);
  });

  it('a second chip tap tags nothing more: one point, the first chip’s kind', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'second');
    await wait(300);
    act_(view, (actions) => {
      actions.tool('chip.double_fault');
      actions.tool('chip.winner');
    });
    await flush();
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([
      { by: AWAY_ENTRANT, server: HOME_PLAYER, meta: { kind: 'double_fault' } },
    ]);
  });

  it('when the hold runs out, it is sent untagged, the chips go, and a late chip changes nothing (the record says so)', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    await wait(10_000);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT, server: HOME_PLAYER }]);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
    await chip(view, 'chip.ace');
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT, server: HOME_PLAYER }]);
    expect(
      readRecord(fakes.record).filter((line) => line.event === 'scoring.point-detail-dropped'),
    ).toEqual([{ level: 'warn', event: 'scoring.point-detail-dropped', fields: { kind: 'ace' } }]);
  });

  it('offline, the chips still go when the hold runs out, though nothing could be sent', async () => {
    const { fakes, view } = await switchedOn();
    fakes.scoring.goOffline(true);
    await point(view, 'first');
    expect(toolIds(pad(view).view)).toEqual(['chip.ace', 'chip.winner', 'chip.ue']);
    await wait(10_000);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
  });

  it('offline behind an unsent point, the chips go when the hold runs out though the match wakes for nothing then', async () => {
    const { fakes, view } = await switchedOn();
    fakes.scoring.goOffline(true);
    await point(view, 'first');
    // The first point's hold runs out at 10 s; its sends then fail at 10, 11, 13, 18, 28, 43 and 58 s (the backoff's
    // 1, 2, 5, 10 and 15 s), so the next try is at 73 s and nothing else moves the match between 60 and 73 s.
    await wait(60_000);
    await point(view, 'second');
    expect(toolIds(pad(view).view)).toEqual(['chip.double_fault', 'chip.winner', 'chip.ue']);
    await wait(10_500);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
  });

  it('the next point lets it go untagged, and is held with chips of its own', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    await wait(300);
    await point(view, 'second');
    await wait(300);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT, server: HOME_PLAYER }]);
    expect(toolIds(pad(view).view)).toEqual(['chip.double_fault', 'chip.winner', 'chip.ue']);
  });

  it('Undo takes it back before anything is sent, and the tools come back', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    await wait(300);
    act_(view, (actions) => actions.undo());
    await flush();
    await wait(11_000);
    expect(await serverPoints(fakes)).toEqual([]);
    expect(toolIds(pad(view).view)).toEqual(TOOLS);
    expect(pad(view).view.halves[0].value).toBe('0');
  });

  it('survives a kill only as an ordinary tap: the reopened app sends it untagged, at once', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    view.unmount();
    const reopened = createFakePorts({
      clock: timerClock,
      scoring: fakes.scoring,
      kvSeed: Object.fromEntries(fakes.kv.entries),
      tapQueue: createTapQueueStore({ files: fakes.queueFiles, logger: fakes.ports.logger }),
    });
    const again = mount(reopened);
    await flush();
    await wait(2_000);
    expect(await serverPoints(fakes)).toEqual([{ by: HOME_ENTRANT, server: HOME_PLAYER }]);
    expect(toolIds(pad(again).view)).toEqual(TOOLS);
  });

  it('another scorer’s point while it is held: the scorer is asked, and Send sends it as the side alone', async () => {
    const { fakes, view } = await switchedOn();
    await point(view, 'first');
    fakes.scoring.addOtherScorerEvent('tennis.point', { by: AWAY_ENTRANT });
    fakes.realtime.ping();
    await wait(2_000);
    expect(pad(view).sheet?.kind).toBe('ask');
    expect(await serverPoints(fakes)).toEqual([{ by: AWAY_ENTRANT }]);
    act_(view, (actions) => actions.sendTaps());
    await flush();
    await wait(10_000);
    // Made on 0-0 with home serving and no chip: the server it named was judged on another point, so it goes untagged.
    expect(await serverPoints(fakes)).toEqual([{ by: AWAY_ENTRANT }, { by: HOME_ENTRANT }]);
  });
});
