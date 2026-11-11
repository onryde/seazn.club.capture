import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import type { BootstrapSide } from '@/domain/scoring/wire';
import { scoringHubOf } from '@/hooks/scoringHub';
import { useVolleyballMatch } from '@/hooks/useVolleyballMatch';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  beachSeed,
  HOME_ENTRANT,
  indoorSeed,
  rallyEvent,
  VOLLEYBALL_BEACH_SEED,
  VOLLEYBALL_DECIDING_SEED,
  VOLLEYBALL_INDOOR_SEED,
  VOLLEYBALL_UNANCHORED_SEED,
} from '@/services/fakeVolleyballPad';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The volleyball match hook (S2-6 Task 9): what the pad screen is drawn from, over the real runner, hub, queue store,
// reducer and fold, and a fake server that judges with the engine alone. Copy is keys here (the screen draws the words);
// every expectation is a literal from the spec (§4, §5) and the owner's rulings 178, 180, 182, 185 and 187.

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

async function rig(seed: FakeMatchSeed = VOLLEYBALL_INDOOR_SEED): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'volleyball');
  return fakes;
}

function mount(fakes: FakePorts, seed: FakeMatchSeed = VOLLEYBALL_INDOOR_SEED) {
  return renderHook(() => useVolleyballMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
}

type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useVolleyballMatch>, { kind: 'pad' }>;

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

/** The pad with the match started by this phone, the first side picked to serve, and Start's bounce window over. */
async function started(fakes: FakePorts, seed: FakeMatchSeed = VOLLEYBALL_INDOOR_SEED) {
  const view = mount(fakes, seed);
  await flush();
  act_(view, (actions) => actions.pickServer('first'));
  act_(view, (actions) => actions.start());
  await flush();
  await wait();
  return view;
}

/** A match another scorer started, on the pad: nothing queued yet, nothing sent offline so the queue shows the taps. */
async function opened(seed: FakeMatchSeed) {
  const fakes = await rig(seed);
  const view = mount(fakes, seed);
  await flush();
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Start screen and the first rally', () => {
  it('Start match carries the side picked, and the first rally carries it as serving', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.rally')).toEqual([
      { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
    ]);
    expect(pad(view).view.halves[1].value).toBe('1');
  });

  it('indoor offers Set score, Timeout, Sub and More; beach has no Sub', async () => {
    const indoor = await started(await rig());
    expect(toolIds(pad(indoor).view)).toEqual(['setScore', 'timeout', 'sub', 'more']);
    const fakes = await rig(VOLLEYBALL_BEACH_SEED);
    const beach = await started(fakes, VOLLEYBALL_BEACH_SEED);
    expect(toolIds(pad(beach).view)).toEqual(['setScore', 'timeout', 'more']);
  });
});

describe('the deciding set toss (ruling 180)', () => {
  it('the first tap at set 5 0-0 asks Who serves first in set 5?, records nothing, and the answer rides the rally', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    fakes.scoring.goOffline(true);
    expect(pad(view).view.halves.map((half) => half.value)).toEqual(['0', '0']);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    const sheet = pad(view).sheet;
    expect(sheet?.kind).toBe('toss');
    expect(sheet).toMatchObject({
      sheet: { title: { key: 'scoring.volleyball.sheet.serving', vars: { set: 5 } } },
    });
    expect(optionIds(sheet)).toEqual(['first', 'second']);
    expect(queued(fakes, VOLLEYBALL_DECIDING_SEED)).toEqual([]);
    await choose(view, 'first');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, VOLLEYBALL_DECIDING_SEED, 'volleyball.rally')).toEqual([
      { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
    ]);
    expect(pad(view).view.halves.map((half) => half.value)).toEqual(['0', '1']);
  });

  it('asks once: after the answer the next tap is a plain rally with no sheet and no serving', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    await choose(view, 'first');
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, VOLLEYBALL_DECIDING_SEED, 'volleyball.rally')).toEqual([
      { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
      { wonBy: HOME_ENTRANT },
    ]);
  });

  // Review focus 1: a co-scorer's rally lands while the sheet is open. The question is moot, the sheet closes, and the tap
  // that follows carries no `serving` (the score has moved; an answer made at another score is not an answer for this one).
  it('closes when another scorer rallies under it, and the next tap sends no serving', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    expect(pad(view).sheet?.kind).toBe('toss');
    fakes.scoring.addOtherScorerEvent('volleyball.rally', { wonBy: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    // The scorer is told why nothing of theirs was recorded, until their next point.
    expect(pad(view).view.lastTap?.text).toEqual({ key: 'scoring.volleyball.tossLost' });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_DECIDING_SEED, 'volleyball.rally')).toEqual([
      { wonBy: AWAY_ENTRANT },
    ]);
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.volleyball.tossLost' });
  });

  it('an answer pressed after the question was answered elsewhere never reaches the wire', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    const stale = pad(view).actions;
    fakes.scoring.addOtherScorerEvent('volleyball.rally', { wonBy: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    fakes.scoring.goOffline(true);
    // The press reaches the old closure, which still thinks the question stands: the rally under it was tapped at a score
    // that no longer stands, so it is not sent (controller ruling, review I3), and the line says another scorer's point
    // got there first.
    act(() => stale.choose('first'));
    await flush();
    expect(queued(fakes, VOLLEYBALL_DECIDING_SEED)).toEqual([]);
    expect(pad(view).view.lastTap?.text).toEqual({ key: 'scoring.volleyball.tossLost' });
  });

  it('a match another scorer started with no server named asks at once on the first tap, as set 1', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_UNANCHORED_SEED);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    expect(pad(view).sheet).toMatchObject({
      kind: 'toss',
      sheet: { title: { vars: { set: 1 } } },
    });
    await choose(view, 'second');
    expect(queuedOf(fakes, VOLLEYBALL_UNANCHORED_SEED, 'volleyball.rally')).toEqual([
      { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    ]);
  });

  it('a second touch of the answer records the rally once', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    const first = pad(view).actions;
    act(() => {
      first.choose('first');
      first.choose('first');
    });
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_DECIDING_SEED, 'volleyball.rally')).toHaveLength(1);
  });
});

// Review I2: Undo of the rally that carried the toss takes the answer with it, so the next tap asks again.
describe('Undo of the rally that carried the deciding set toss', () => {
  it('offline (the void is queued): the next tap opens the toss sheet again', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    await choose(view, 'first');
    await wait(1_000);
    act_(view, (actions) => actions.undo());
    await flush();
    await wait(1_000);
    expect(queued(fakes, VOLLEYBALL_DECIDING_SEED).map((tap) => tap.type)).toContain('core.void');
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    expect(pad(view).sheet?.kind).toBe('toss');
  });

  it('online (the void is taken): the score is back to 0-0 and the next tap asks again', async () => {
    const { view } = await opened(VOLLEYBALL_DECIDING_SEED);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    await choose(view, 'first');
    await flush();
    await wait(1_000);
    act_(view, (actions) => actions.undo());
    await flush();
    await wait(1_000);
    await flush();
    expect(pad(view).view.halves.map((half) => half.value)).toEqual(['0', '0']);
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    expect(pad(view).sheet?.kind).toBe('toss');
  });
});

// Review M1: a rally the match refuses leaves the answer held; the next tap at the same 0-0 does not ask again.
describe('a refused toss rally', () => {
  it('keeps the answer held, and the next tap carries it without asking', async () => {
    const { fakes, view } = await opened(VOLLEYBALL_DECIDING_SEED);
    const { runner } = scoringHubOf(fakes.ports).focus(VOLLEYBALL_DECIDING_SEED.fixtureId);
    const real = runner.dispatch.bind(runner);
    let refused = false;
    vi.spyOn(runner, 'dispatch').mockImplementation((event) => {
      if (event.kind === 'tap' && !refused) {
        refused = true;
        return { ok: false, refusal: 'notNow' };
      }
      return real(event);
    });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    await choose(view, 'first');
    expect(refused).toBe(true);
    expect(queued(fakes, VOLLEYBALL_DECIDING_SEED)).toEqual([]);
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.volleyball.held' });
    await wait(1_000);
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, VOLLEYBALL_DECIDING_SEED, 'volleyball.rally')).toEqual([
      { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
    ]);
  });
});

/** Another scorer started the match: the Start screen's pick is theirs, no rally yet (Set score still on offer). */
const LOST_ANCHOR_PRE = indoorSeed({
  fixtureId: 'fake-vb-pre',
  events: [{ type: 'core.start', payload: {} }],
});

/** Another scorer set the set's score mid-set (10-8): the engine can name no server, so the pad asks. */
const LOST_ANCHOR = indoorSeed({
  fixtureId: 'fake-vb-lost-anchor',
  events: [
    { type: 'core.start', payload: {} },
    rallyEvent('first', 'first'),
    { type: 'volleyball.set.summary', payload: { home: 10, away: 8, partial: true } },
  ],
});

describe('Who serves? mid-set: the answer is held for the next point', () => {
  async function lostAnchor() {
    return opened(LOST_ANCHOR);
  }

  it('holds the side, says so on the last-tap line, and the next point carries it', async () => {
    const { fakes, view } = await lostAnchor();
    expect(toolIds(pad(view).view)).toContain('serving');
    await press(view, 'serving');
    await choose(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({
      key: 'scoring.volleyball.held',
      vars: { side: 'Herons' },
    });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(queuedOf(fakes, LOST_ANCHOR, 'volleyball.rally')).toEqual([
      { wonBy: HOME_ENTRANT, serving: AWAY_ENTRANT },
    ]);
  });

  // After a process death the held answer is gone (memory only): the pad asks again.
  it('a held answer does not survive a restart: the new hook holds nothing and the tool asks again', async () => {
    const { fakes, view } = await lostAnchor();
    await press(view, 'serving');
    await choose(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.volleyball.held' });
    view.unmount();
    const again = mount(fakes, LOST_ANCHOR);
    await flush();
    expect(pad(again).view.lastTap?.text).not.toMatchObject({ key: 'scoring.volleyball.held' });
    expect(toolIds(pad(again).view)).toContain('serving');
  });

  it('Undo of this phone’s last tap takes the held answer with it', async () => {
    const { fakes, view } = await lostAnchor();
    await press(view, 'timeout');
    await choose(view, 'first');
    await press(view, 'serving');
    await choose(view, 'second');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.volleyball.held' });
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(pad(view).view.lastTap?.text).not.toMatchObject({ key: 'scoring.volleyball.held' });
  });
});

describe('a first tap that must not ask', () => {
  it('mid-set with no server named and nothing held, a tap is a plain rally: the Who serves? cell is the way to ask', async () => {
    const { fakes, view } = await opened(LOST_ANCHOR);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, LOST_ANCHOR, 'volleyball.rally')).toEqual([{ wonBy: HOME_ENTRANT }]);
  });

  it('under a card (the match is the organiser’s, view only) the tap opens no sheet', async () => {
    const seed: FakeMatchSeed = {
      ...VOLLEYBALL_DECIDING_SEED,
      fixtureId: 'fake-vb-deciding-locked',
      linkId: 'fake-link-fake-vb-deciding-locked',
      viewOnlyReason: 'finalized',
    };
    const { view } = await opened(seed);
    expect(pad(view).view.card).not.toBeNull();
    act_(view, (actions) => actions.tapHalf('second'));
    await wait(300);
    expect(pad(view).sheet).toBeNull();
  });

  it('a choice in the bounce window of its sheet appearing is the second touch of a double tap and records nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tool('timeout'));
    act_(view, (actions) => actions.choose('first'));
    await flush();
    expect(queued(fakes, VOLLEYBALL_INDOOR_SEED)).toEqual([]);
    expect(pad(view).sheet?.kind).toBe('side');
  });
});

/** Two sets to France and the third at 24-0: one more rally by the first side decides the match. */
const MATCH_POINT = indoorSeed({
  fixtureId: 'fake-vb-match-point',
  events: [
    { type: 'core.start', payload: {} },
    ...Array.from({ length: 25 }, (_, i) => rallyEvent('first', i === 0 ? 'first' : undefined)),
    ...Array.from({ length: 25 }, () => rallyEvent('first')),
    ...Array.from({ length: 24 }, () => rallyEvent('first')),
  ],
});

describe('a sheet whose tool the match has taken away closes (the pad is the server’s view)', () => {
  const decide = async (view: Match, fakes: FakePorts) => {
    fakes.scoring.addOtherScorerEvent('volleyball.rally', { wonBy: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(toolIds(pad(view).view)).toEqual([]);
  };

  it.each([
    ['Timeout’s side choice', ['timeout'], []],
    ['Sub’s side choice', ['sub'], []],
    ['Sub’s player step', ['sub'], ['first']],
    ['More', ['more'], []],
    ['Sanction’s level step', ['more'], ['sanction.first']],
  ] as const)('%s', async (_name, tools, choices) => {
    const { fakes, view } = await opened(MATCH_POINT);
    for (const id of tools) await press(view, id);
    for (const id of choices) await choose(view, id);
    expect(pad(view).sheet).not.toBeNull();
    await decide(view, fakes);
    expect(pad(view).sheet).toBeNull();
  });

  it('Set score’s sheet closes when a rally stands', async () => {
    const { fakes, view } = await opened(LOST_ANCHOR_PRE);
    await press(view, 'setScore');
    expect(pad(view).sheet?.kind).toBe('setScore');
    fakes.scoring.addOtherScorerEvent('volleyball.rally', {
      wonBy: HOME_ENTRANT,
      serving: HOME_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
  });
});

describe('Timeout and Sub: a side choice (ruling 178)', () => {
  it('Timeout asks the side, and a side tapped twice records once', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'timeout');
    const sheet = pad(view).sheet;
    expect(sheet).toMatchObject({
      kind: 'side',
      sheet: { title: { key: 'scoring.volleyball.sheet.timeout' } },
    });
    expect(optionIds(sheet)).toEqual(['first', 'second']);
    const actions = pad(view).actions;
    act(() => {
      actions.choose('second');
      actions.choose('second');
    });
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.timeout')).toEqual([
      { by: AWAY_ENTRANT },
    ]);
    expect(pad(view).sheet).toBeNull();
  });

  it('Sub asks the side, then who comes off, then who comes on, and records the pair by id', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'sub');
    expect(pad(view).sheet).toMatchObject({
      kind: 'side',
      sheet: { title: { key: 'scoring.volleyball.sheet.sub' } },
    });
    await choose(view, 'first');
    expect(pad(view).sheet).toMatchObject({
      kind: 'sub',
      sheet: { title: { key: 'scoring.volleyball.sheet.off' } },
    });
    expect(optionIds(pad(view).sheet)).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) => `${HOME_ENTRANT}-p${n}`),
    );
    await choose(view, `${HOME_ENTRANT}-p1`);
    expect(pad(view).sheet).toMatchObject({
      kind: 'sub',
      sheet: { title: { key: 'scoring.volleyball.sheet.on' } },
    });
    await choose(view, `${HOME_ENTRANT}-p7`);
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.sub')).toEqual([
      { by: HOME_ENTRANT, off: `${HOME_ENTRANT}-p1`, on: `${HOME_ENTRANT}-p7` },
    ]);
  });

  it('a fixture with no team sheet records the sub for the side alone', async () => {
    const seed = indoorSeed({ fixtureId: 'fake-vb-nosheet', sheet: 'none' });
    const fakes = await rig(seed);
    const view = await started(fakes, seed);
    fakes.scoring.goOffline(true);
    await press(view, 'sub');
    await choose(view, 'second');
    expect(pad(view).sheet).toBeNull();
    expect(queuedOf(fakes, seed, 'volleyball.sub')).toEqual([{ by: AWAY_ENTRANT }]);
  });
});

describe('Sanction in More (rulings 174, 185, 187)', () => {
  it('More lists Sanction per side, the level then the person, and records a warning with no note', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'more');
    const more = pad(view).sheet;
    expect(more?.kind).toBe('more');
    expect(optionIds(more)).toEqual(['sanction.first', 'sanction.second']);
    await choose(view, 'sanction.first');
    expect(optionIds(pad(view).sheet)).toEqual([
      'warning',
      'penalty',
      'expulsion',
      'disqualification',
    ]);
    await choose(view, 'warning');
    // Players first, then the coach.
    expect(optionIds(pad(view).sheet).slice(-1)).toEqual([`${HOME_ENTRANT}-coach`]);
    await choose(view, `${HOME_ENTRANT}-coach`);
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.sanction')).toEqual([
      { by: HOME_ENTRANT, level: 'warning', person: `${HOME_ENTRANT}-coach` },
    ]);
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.volleyball.last.sanction' });
    expect(pad(view).view.halves[0].marks.cards).toEqual(['caution']);
  });

  it('a penalty says whose rally to tap (ruling 185), an expulsion that the organiser ends the match', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'more');
    await choose(view, 'sanction.first');
    await choose(view, 'penalty');
    await choose(view, `${HOME_ENTRANT}-p2`);
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.volleyball.done.penalty',
      vars: { side: 'Herons' },
    });
    expect(pad(view).view.lastTap?.undo).toBe(true);
    await press(view, 'more');
    await choose(view, 'sanction.second');
    await choose(view, 'expulsion');
    await choose(view, `${AWAY_ENTRANT}-p2`);
    expect(pad(view).view.lastTap?.text).toEqual({
      key: 'scoring.volleyball.done.fieldSix',
      vars: { level: { key: 'scoring.sanction.expulsion' }, team: 'Herons' },
    });
  });

  it('a sanction’s double touch on its person records once', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'more');
    await choose(view, 'sanction.second');
    await choose(view, 'warning');
    const actions = pad(view).actions;
    act(() => {
      actions.choose(`${AWAY_ENTRANT}-p1`);
      actions.choose(`${AWAY_ENTRANT}-p1`);
    });
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.sanction')).toHaveLength(1);
  });
});

/** A side the organiser re-saved on the web: one new player (a libero) on the bench, ids as the fake builds them. */
function withLibero(side: BootstrapSide): BootstrapSide {
  return {
    ...side,
    members: [...side.members, { personId: `${side.entrantId}-new`, fullName: 'N. Newcomer' }],
    lineup: [
      ...side.lineup,
      {
        personId: `${side.entrantId}-new`,
        pairOrder: null,
        slot: 'bench' as const,
        orderNo: 9,
        role: 'player',
      },
    ],
  };
}

describe('the people sheets read the teams again (ruling 181)', () => {
  async function reSaved() {
    const fakes = await rig();
    const view = await started(fakes);
    await wait(16_000);
    const home = VOLLEYBALL_INDOOR_SEED.sides.home;
    fakes.scoring.setSide('home', withLibero(home));
    return { fakes, view };
  }

  it('Sub lists a player saved on the web after the pad opened', async () => {
    const { view } = await reSaved();
    await press(view, 'sub');
    await flush();
    await choose(view, 'first');
    expect(optionIds(pad(view).sheet)).toContain(`${HOME_ENTRANT}-new`);
  });

  it('More’s Sanction lists the new player too', async () => {
    const { view } = await reSaved();
    await press(view, 'more');
    await flush();
    await choose(view, 'sanction.first');
    await choose(view, 'warning');
    expect(optionIds(pad(view).sheet)).toContain(`${HOME_ENTRANT}-new`);
  });

  it('Timeout lists no people and asks nothing of the server', async () => {
    const { fakes, view } = await reSaved();
    const asked = vi.spyOn(fakes.scoring, 'bootstrap');
    await press(view, 'timeout');
    await flush();
    expect(asked).not.toHaveBeenCalled();
  });

  it('a sheet left open across background and foreground stays open', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    await press(view, 'sub');
    await choose(view, 'first');
    expect(pad(view).sheet?.kind).toBe('sub');
    act(() => fakes.foreground.leave());
    await wait(1_000);
    act(() => fakes.foreground.fire());
    await flush();
    expect(pad(view).sheet?.kind).toBe('sub');
  });
});

describe('Set score', () => {
  it('is offered before a set’s first rally, saves a partial summary, and goes once a rally stands', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    expect(toolIds(pad(view).view)).toContain('setScore');
    await press(view, 'setScore');
    expect(pad(view).sheet).toMatchObject({ kind: 'setScore', game: 1, bound: expect.any(Number) });
    act_(view, (actions) => actions.saveScore('10', '8'));
    await flush();
    expect(queuedOf(fakes, VOLLEYBALL_INDOOR_SEED, 'volleyball.set.summary')).toEqual([
      { home: 10, away: 8, partial: true },
    ]);
    await wait();
    // The set score named no server: the first tap after it asks who serves, as at any 0-0 (ruling 180).
    act_(view, (actions) => actions.tapHalf('first'));
    await wait(300);
    expect(pad(view).sheet?.kind).toBe('toss');
    await choose(view, 'first');
    expect(toolIds(pad(view).view)).not.toContain('setScore');
  });

  it('a field that is not a whole number says so and records nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
    fakes.scoring.goOffline(true);
    await press(view, 'setScore');
    act_(view, (actions) => actions.saveScore('ten', '8'));
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.invalidScore' });
    expect(queued(fakes, VOLLEYBALL_INDOOR_SEED)).toEqual([]);
  });
});

describe('beach', () => {
  it('names the server on a rally once the pair order is declared, and Timeout is the one tool of its kind', async () => {
    const seed = beachSeed({ fixtureId: 'fake-vb-beach-hook' });
    const fakes = await rig(seed);
    const view = await started(fakes, seed);
    fakes.scoring.goOffline(true);
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    await wait();
    act_(view, (actions) => actions.tapHalf('second'));
    await flush();
    const rallies = queuedOf(fakes, seed, 'volleyball.rally');
    expect(rallies[0]).toMatchObject({ wonBy: HOME_ENTRANT, serving: HOME_ENTRANT });
    expect(rallies[1]).toMatchObject({ wonBy: AWAY_ENTRANT });
    expect(rallies[1]).toHaveProperty('server');
  });
});

describe('every other pad button', () => {
  it('Match details and History open and close, and Back closes a sheet and records nothing', async () => {
    const fakes = await rig();
    const view = await started(fakes);
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
  });
});
