import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footballBoard, footballClockBar } from '@/domain/scoring/footballBoard';
import { scoringHubOf } from '@/hooks/scoringHub';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { footballSeed, HOME_ENTRANT, AWAY_ENTRANT } from '@/services/fakeFootballPad';
import {
  createFakeScoringPort,
  type FakeMatchSeed,
  type FakeSeedEvent,
} from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The football match hook (S2-5 plan P Task 11): what the pad screen is drawn from, over the real runner, hub, queue
// store, reducer and fold, and a fake server that judges with the engine alone. Copy is keys here (the screen draws the
// words); every expectation is a literal from the design (§6, §7) and the controller's Batch C rulings.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const T0 = Date.parse('2026-11-08T14:00:00.000Z');

const START: FakeSeedEvent = { type: 'core.start', payload: {} };
const KICK_OFF: FakeSeedEvent = {
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
};

/** Started on the console and the clock running from 0:00 at T0. */
const LIVE = footballSeed({ events: [START, KICK_OFF] });
/** Started, the clock not yet. */
const STARTED = footballSeed({ events: [START] });
const NOT_STARTED = footballSeed();

const home = (n: number) => `${HOME_ENTRANT}-p${n}`;
const away = (n: number) => `${AWAY_ENTRANT}-p${n}`;
const P = (id: string) => `p.${id}`;

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

type Rig = { readonly seed?: FakeMatchSeed; readonly strict?: boolean; readonly fakes?: FakePorts };

async function opened({ seed = LIVE, strict = false, fakes: given }: Rig = {}) {
  const fakes = given ?? createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'football');
  const Base = wrapperFor(fakes);
  const wrapper = strict
    ? ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <Base>{children}</Base>
        </StrictMode>
      )
    : Base;
  const view = renderHook(() => useFootballMatch(seed.fixtureId), { wrapper });
  await flush();
  await wait();
  return { fakes, view };
}

type Match = Awaited<ReturnType<typeof opened>>['view'];
type Pad = Extract<ReturnType<typeof useFootballMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const press = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

/** The ledger's events, as the server holds them. */
async function ledger(fakes: FakePorts, seed: FakeMatchSeed = LIVE) {
  const events = await fakes.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const typesOf = async (fakes: FakePorts, seed?: FakeMatchSeed) =>
  (await ledger(fakes, seed)).map((event) => event.type);

async function lastEvent(fakes: FakePorts, seed?: FakeMatchSeed) {
  return (await ledger(fakes, seed)).at(-1);
}

/** The step sheet over the pad: its title's key and its choices' ids. */
function stepOf(view: Match) {
  const { sheet } = pad(view);
  if (sheet?.kind !== 'step') return null;
  return { title: sheet.sheet.title.key, ids: sheet.sheet.options.map((option) => option.id) };
}

/** A choice on the step on screen, after its bounce window. */
async function pick(view: Match, id: string) {
  await wait(300);
  press(view, (actions) => actions.choose(id));
  await flush();
}

/** A column's button, then the wait that takes its bounce window away. */
async function column(view: Match, id: string) {
  press(view, (actions) => actions.column(id));
  await wait(300);
}

const lines = (fakes: FakePorts, event: string) =>
  readRecord(fakes.record).filter((line) => line.event === event);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Start screen and the clock', () => {
  it('the Start match tap needs no pick', async () => {
    const { fakes, view } = await opened({ seed: NOT_STARTED });
    expect(pad(view).toss).toBeNull();
    expect(pad(view).view.start?.needsToss).toBe(false);
    press(view, (actions) => actions.start());
    await flush();
    expect(await typesOf(fakes, NOT_STARTED)).toEqual(['core.start']);
  });

  it('Start match then Start queues core.start then football.clock running at H1 0', async () => {
    const { fakes, view } = await opened({ seed: NOT_STARTED });
    press(view, (actions) => actions.start());
    await flush();
    await wait();
    press(view, (actions) => actions.clock());
    await flush();
    expect(await typesOf(fakes, NOT_STARTED)).toEqual(['core.start', 'football.clock']);
    expect((await lastEvent(fakes, NOT_STARTED))?.payload).toEqual({
      running: true,
      at: { period: 'H1', elapsed: 0 },
    });
    // The record's line (plan P Task 9): the action and the phase, nothing of a person.
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields)).toEqual([
      { action: 'start', phase: 'H1' },
    ]);
  });

  it('a second Start while the first is queued queues nothing (the button now reads Pause)', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    press(view, (actions) => actions.clock());
    press(view, (actions) => actions.clock());
    await flush();
    expect(await typesOf(fakes, STARTED)).toEqual(['core.start', 'football.clock']);
    expect(footballClockBar(pad(view).display, 0).action?.kind).toBe('pause');
  });

  it('Pause stops the clock at the reading, and the record says pause', async () => {
    const { fakes, view } = await opened();
    await wait(41_000);
    press(view, (actions) => actions.clock());
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({
      running: false,
      at: { period: 'H1', elapsed: 42 },
    });
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'pause',
    ]);
    await wait(10_000);
    expect(pad(view).readingNow()).toBe(42);
  });

  it('a Pause on the console stops the reading', async () => {
    const { fakes, view } = await opened();
    await wait(29_000);
    expect(pad(view).readingNow()).toBe(30);
    fakes.scoring.addOtherScorerEvent('football.clock', {
      running: false,
      at: { period: 'H1', elapsed: 30 },
    });
    fakes.realtime.ping();
    await flush();
    await wait(60_000);
    expect(pad(view).readingNow()).toBe(30);
    expect(footballClockBar(pad(view).display, pad(view).readingNow()).time).toBe('0:30');
  });

  // The controller's ruling 1: the console's clock event is another device's (its link is not this phone's), recorded
  // at the server's time, which runs 5 minutes ahead of this phone's.
  it('a phone 5 minutes slow reads the console’s minute', async () => {
    const seed = STARTED;
    // The server's own port, its events stamped by the server's clock (the default fake stamps by the phone's).
    const scoring = createFakeScoringPort(seed, { stamp: () => Date.now() + 300_000 });
    const fakes = createFakePorts({ clock: timerClock, scoring });
    fakes.serverClock.setOffset(300_000);
    const { view } = await opened({ seed, fakes });
    const console = scoring.addOtherScorerEvent('football.clock', {
      running: true,
      at: { period: 'H1', elapsed: 600 },
    });
    expect(console.deviceLinkId).not.toBeNull();
    expect(Date.parse(console.recordedAt)).toBe(Date.now() + 300_000);
    fakes.realtime.ping();
    await flush();
    await wait(30_000);
    expect(pad(view).readingNow()).toBe(630);
  });

  it('Correct −1 min stops at the floor, and Set records the clock there, still running', async () => {
    const { fakes, view } = await opened();
    await wait(29_000);
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 30 },
    });
    fakes.realtime.ping();
    await flush();
    await wait(10_000);
    expect(pad(view).readingNow()).toBe(40);
    press(view, (actions) => actions.correct());
    await wait(300);
    expect(pad(view).sheet).toEqual({ kind: 'correct', deltaSeconds: 0, floor: 30 });
    press(view, (actions) => actions.step(-60));
    expect(pad(view).sheet).toEqual({ kind: 'correct', deltaSeconds: -10, floor: 30 });
    press(view, (actions) => actions.set());
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({
      running: true,
      at: { period: 'H1', elapsed: 30 },
    });
    expect(pad(view).sheet).toBeNull();
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'correct',
    ]);
  });
});

describe('Correct, More and Undo', () => {
  it('Set after the console stamps a later event records at that event, the floor now', async () => {
    const { fakes, view } = await opened();
    await wait(29_000);
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 30 },
    });
    fakes.realtime.ping();
    await flush();
    await wait(10_000);
    press(view, (actions) => actions.correct());
    await wait(300);
    press(view, (actions) => actions.step(-60));
    expect(pad(view).sheet).toEqual({ kind: 'correct', deltaSeconds: -10, floor: 30 });
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 35 },
    });
    fakes.realtime.ping();
    await flush();
    press(view, (actions) => actions.set());
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({
      running: true,
      at: { period: 'H1', elapsed: 35 },
    });
  });

  it('Correct opens nothing at full time: the engine takes no clock event then', async () => {
    const seed = footballSeed({
      cfg: {
        halves: 2,
        halfMinutes: 45,
        extraTime: { enabled: false, halfMinutes: 15 },
        shootout: false,
      },
      events: [
        START,
        KICK_OFF,
        { type: 'football.period', payload: { phase: 'HT', at: { period: 'H1', elapsed: 2700 } } },
        { type: 'football.clock', payload: { running: true, at: { period: 'H2', elapsed: 0 } } },
        { type: 'football.period', payload: { phase: 'FT', at: { period: 'H2', elapsed: 2700 } } },
      ],
    });
    const { view } = await opened({ seed });
    expect(pad(view).display.enginePhase).toBe('done');
    press(view, (actions) => actions.correct());
    await wait(300);
    expect(pad(view).sheet).toBeNull();
  });

  it('a stepper or Set touched in the bounce window of Correct appearing does nothing', async () => {
    const { fakes, view } = await opened();
    await wait(29_000);
    press(view, (actions) => actions.correct());
    press(view, (actions) => actions.step(10));
    press(view, (actions) => actions.set());
    expect(pad(view).sheet).toEqual({ kind: 'correct', deltaSeconds: 0, floor: 0 });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock']);
  });

  // The controller's fix-round ruling (e), superseding the Batch C behaviour: Correct waits for the period's first Start.
  it('Correct at the break is not offered: nothing opens, nothing is recorded, and the bar keeps Half-time', async () => {
    const seed = footballSeed({
      events: [
        START,
        KICK_OFF,
        { type: 'football.period', payload: { phase: 'HT', at: { period: 'H1', elapsed: 2700 } } },
      ],
    });
    const { fakes, view } = await opened({ seed });
    expect(pad(view).display.enginePhase).toBe('H2');
    press(view, (actions) => actions.correct());
    await wait(300);
    expect(pad(view).sheet).toBeNull();
    await flush();
    expect(await typesOf(fakes, seed)).toEqual(['core.start', 'football.clock', 'football.period']);
    const bar = footballClockBar(pad(view).display, pad(view).readingNow());
    expect(bar.period).toEqual({ key: 'scoring.football.break.halfTime' });
  });

  it('Correct before the first Start is not offered either: there is no 0:00 to move', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    press(view, (actions) => actions.correct());
    await wait(300);
    expect(pad(view).sheet).toBeNull();
    await flush();
    expect(await typesOf(fakes, STARTED)).toEqual(['core.start']);
  });

  it('More opens its sheet, and the console’s HT closes it', async () => {
    const { fakes, view } = await opened();
    press(view, (actions) => actions.tool('more'));
    await wait(300);
    expect(stepOf(view)?.title).toBe('scoring.football.tool.more');
    fakes.scoring.addOtherScorerEvent('football.period', {
      phase: 'HT',
      at: { period: 'H1', elapsed: 2700 },
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
  });

  it('Undo of a goal takes back that goal alone, not this phone’s goal under it', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    await pick(view, 'dontKnow');
    await wait(1_000);
    await column(view, 'goal.second');
    await pick(view, 'dontKnow');
    await wait(1_000);
    const goal = await lastEvent(fakes);
    expect(goal?.type).toBe('football.goal');
    press(view, (actions) => actions.undo());
    await flush();
    await wait(1_000);
    const voids = (await ledger(fakes)).filter((event) => event.type === 'core.void');
    expect(voids.map((event) => event.voids)).toEqual([goal!.id]);
    expect(await typesOf(fakes)).toEqual([
      'core.start',
      'football.clock',
      'football.goal',
      'football.goal',
      'core.void',
    ]);
    expect(pad(view).display.goals).toEqual({ first: 1, second: 0 });
  });
});

describe('the reconnect question (owner ruling 43)', () => {
  /** This phone recorded a goal offline, the console recorded one meanwhile, and the phone is back. */
  async function asked() {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    await column(view, 'goal.first');
    await pick(view, 'dontKnow');
    await wait();
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 2 },
    });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    return { fakes, view };
  }

  it('asks over the pad with the counts, holds the goal back, and a column opens nothing', async () => {
    const { fakes, view } = await asked();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { foreign: 1, queued: 1 } });
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock', 'football.goal']);
    await column(view, 'goal.first');
    expect(pad(view).sheet).toMatchObject({ kind: 'ask' });
  });

  it('a sheet open when the question comes is gone once it is answered', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    await column(view, 'goal.first');
    await pick(view, 'dontKnow');
    await wait();
    await column(view, 'yellow.first');
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.yellow');
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 2 },
    });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toMatchObject({ kind: 'ask' });
    press(view, (actions) => actions.sendTaps());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
  });

  it('Send my taps sends the goal, and the question goes', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    press(view, (actions) => actions.sendTaps());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual([
      'core.start',
      'football.clock',
      'football.goal',
      'football.goal',
    ]);
  });

  it('a Discard touched as the question appears does nothing: it is the second touch of a tap on the pad', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    await column(view, 'goal.first');
    await pick(view, 'dontKnow');
    await wait();
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 2 },
    });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask' });
    press(view, (actions) => actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('ask');
    await wait(300);
    press(view, (actions) => actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
  });

  it('a Goal for a team with no sheet records nothing while the question stands', async () => {
    const seed = footballSeed({ sheet: 'none', events: [START, KICK_OFF] });
    const { fakes, view } = await opened({ seed });
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.column('goal.first'));
    await flush();
    await wait();
    fakes.scoring.addOtherScorerEvent('football.goal', {
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 2 },
    });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { queued: 1 } });
    press(view, (actions) => actions.column('goal.first'));
    await flush();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { queued: 1 } });
  });

  it('Discard asks again, and its confirm deletes the goal', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    press(view, (actions) => actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
    await wait(300);
    press(view, (actions) => actions.confirmDiscard());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock', 'football.goal']);
    expect(pad(view).display.goals).toEqual({ first: 0, second: 1 });
  });
});

describe('the columns’ sheets (design §6.3)', () => {
  it('a double tap on Goal opens one sheet, and its second touch chooses nothing', async () => {
    const { fakes, view } = await opened();
    press(view, (actions) => actions.column('goal.first'));
    press(view, (actions) => actions.column('goal.first'));
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.whoScored');
    press(view, (actions) => actions.choose('dontKnow'));
    await flush();
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.whoScored');
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock']);
  });

  it('a double tap whose second touch lands on Cancel leaves the sheet open', async () => {
    const { view } = await opened();
    // Two touches at one moment, the screen drawn between them: the second lands on the sheet.
    press(view, (actions) => actions.column('goal.first'));
    press(view, (actions) => actions.cancelSheet());
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.whoScored');
  });

  it('a double tap on a scorer moves to the assist once: the second touch, on the row now under it, chooses nothing', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    press(view, (actions) => actions.choose(P(home(9))));
    press(view, (actions) => actions.choose(P(home(10))));
    await flush();
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.assist');
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock']);
  });

  it('Goal → H-p9 → No assist queues one football.goal stamped at the press, not at the close', async () => {
    const { fakes, view } = await opened();
    await wait(9_000);
    await column(view, 'goal.first');
    await wait(20_000);
    await pick(view, P(home(9)));
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.assist');
    await pick(view, 'noAssist');
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock', 'football.goal']);
    expect((await lastEvent(fakes))?.payload).toEqual({
      by: HOME_ENTRANT,
      scorer: home(9),
      at: { period: 'H1', elapsed: 10 },
    });
    expect(pad(view).sheet).toBeNull();
  });

  it('Cancel queues nothing, and nor does Back', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    press(view, (actions) => actions.cancelSheet());
    expect(pad(view).sheet).toBeNull();
    await wait(300);
    await column(view, 'card.second');
    act(() => void fakes.back.press());
    expect(pad(view).sheet).toBeNull();
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock']);
  });

  it('Own goal in home’s column queues by away', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    await pick(view, 'ownGoal');
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.whoPutItIn');
    await pick(view, P(away(5)));
    expect((await lastEvent(fakes))?.payload).toMatchObject({
      by: AWAY_ENTRANT,
      ownGoal: true,
      scorer: away(5),
    });
    expect(pad(view).display.goals).toEqual({ first: 1, second: 0 });
  });

  it('Penalty skips the assist', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    await pick(view, 'penalty');
    await pick(view, P(home(10)));
    expect(pad(view).sheet).toBeNull();
    expect((await lastEvent(fakes))?.payload).toMatchObject({
      by: HOME_ENTRANT,
      scorer: home(10),
      penalty: true,
    });
  });

  it('Yellow lists every bookable player, a yellowed one noted; choosing him books a second yellow', async () => {
    const booked = footballSeed({
      events: [
        START,
        KICK_OFF,
        { type: 'football.card', payload: { by: HOME_ENTRANT, person: home(4), color: 'yellow' } },
      ],
    });
    const { fakes, view } = await opened({ seed: booked });
    await column(view, 'yellow.first');
    expect(stepOf(view)?.ids).toContain(P(home(4)));
    expect(stepOf(view)?.ids).toContain(P(home(7)));
    expect(stepOf(view)?.ids.some((id) => id.startsWith('color.'))).toBe(false);
    await pick(view, P(home(4)));
    await pick(view, 'noReason');
    expect((await lastEvent(fakes))?.payload).toMatchObject({
      by: HOME_ENTRANT,
      person: home(4),
      color: 'second_yellow',
    });
  });

  it('Red books a red for the player chosen', async () => {
    const { fakes, view } = await opened();
    await column(view, 'red.second');
    await pick(view, P(away(6)));
    await pick(view, 'noReason');
    expect((await lastEvent(fakes))?.payload).toMatchObject({
      by: AWAY_ENTRANT,
      person: away(6),
      color: 'red',
    });
  });

  it('a double tap on Yellow opens one sheet', async () => {
    const { view } = await opened();
    await column(view, 'yellow.first');
    await column(view, 'yellow.first');
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.yellow');
    press(view, (actions) => actions.cancelSheet());
    await flush();
    expect(pad(view).sheet).toBeNull();
  });

  it('Sub → off → on queues one football.sub with asOf', async () => {
    const { fakes, view } = await opened();
    await wait(60_000);
    await column(view, 'sub.first');
    await pick(view, P(home(7)));
    await pick(view, P(home(14)));
    expect((await lastEvent(fakes))?.payload).toEqual({
      by: HOME_ENTRANT,
      off: home(7),
      on: home(14),
      at: { period: 'H1', elapsed: 0 },
    });
  });

  it('Sub is disabled with No team sheet on noSlots, and opens nothing', async () => {
    const seed = footballSeed({ sheet: 'noSlots', events: [START, KICK_OFF] });
    const { view } = await opened({ seed });
    const sub = footballBoard(pad(view).display, pad(view).view.card).columns[0].actions[3];
    expect(sub).toMatchObject({
      id: 'sub.first',
      enabled: false,
      note: { key: 'scoring.football.column.noSheet' },
    });
    await column(view, 'sub.first');
    expect(pad(view).sheet).toBeNull();
  });

  it('Goal for a team with no sheet records nothing once the match is decided', async () => {
    const seed = footballSeed({
      sheet: 'none',
      cfg: {
        halves: 2,
        halfMinutes: 45,
        extraTime: { enabled: false, halfMinutes: 15 },
        shootout: false,
      },
      events: [
        START,
        KICK_OFF,
        { type: 'football.period', payload: { phase: 'HT', at: { period: 'H1', elapsed: 2700 } } },
        { type: 'football.clock', payload: { running: true, at: { period: 'H2', elapsed: 0 } } },
        { type: 'football.period', payload: { phase: 'FT', at: { period: 'H2', elapsed: 2700 } } },
      ],
    });
    const { fakes, view } = await opened({ seed });
    const before = await typesOf(fakes, seed);
    press(view, (actions) => actions.column('goal.first'));
    await flush();
    await wait();
    expect(await typesOf(fakes, seed)).toEqual(before);
    expect(pad(view).display.goals).toEqual({ first: 0, second: 0 });
  });

  it('Goal on a side with no sheet records at once', async () => {
    const seed = footballSeed({ sheet: 'none', events: [START, KICK_OFF] });
    const { fakes, view } = await opened({ seed });
    await wait(4_000);
    press(view, (actions) => actions.column('goal.second'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect((await lastEvent(fakes, seed))?.payload).toEqual({
      by: AWAY_ENTRANT,
      at: { period: 'H1', elapsed: 5 },
    });
  });

  it('HT recorded by the console closes an open Goal sheet', async () => {
    const { fakes, view } = await opened();
    await column(view, 'goal.first');
    expect(stepOf(view)).not.toBeNull();
    fakes.scoring.addOtherScorerEvent('football.period', {
      phase: 'HT',
      at: { period: 'H1', elapsed: 2700 },
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
  });

  it('the console’s last substitution closes an open Sub sheet: its button is off now', async () => {
    const seed = footballSeed({ cfg: { maxSubs: 1 }, events: [START, KICK_OFF] });
    const { fakes, view } = await opened({ seed });
    await column(view, 'sub.first');
    expect(stepOf(view)?.title).toBe('scoring.football.sheet.whoComesOff');
    fakes.scoring.addOtherScorerEvent('football.sub', {
      by: HOME_ENTRANT,
      off: home(2),
      on: home(12),
      at: { period: 'H1', elapsed: 0 },
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).display.enginePhase).toBe('H1');
    expect(pad(view).sheet).toBeNull();
  });

  it('backgrounding with a sheet open closes it', async () => {
    const { fakes, view } = await opened();
    await column(view, 'card.first');
    act(() => fakes.foreground.leave());
    expect(pad(view).sheet).toBeNull();
    act(() => fakes.foreground.fire());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'football.clock']);
  });

  it('End of period records the marker at the reading and says it in the record', async () => {
    const { fakes, view } = await opened();
    await wait(59_000);
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({
      phase: 'HT',
      at: { period: 'H1', elapsed: 60 },
    });
    expect(lines(fakes, 'scoring.football.period').map((line) => line.fields.phase)).toEqual([
      'HT',
    ]);
  });

  it('End of period on a link that died is refused, and the record does not say it', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.revoke();
    press(view, (actions) => actions.clock());
    await wait(1_000);
    expect(pad(view).view.card).toEqual({ kind: 'linkInvalid' });
    expect(pad(view).display.marker).toBe('HT');
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect(lines(fakes, 'scoring.football.period')).toEqual([]);
  });
});

// The controller's ruling 2: a Start accepted 3 s or more after its tap is followed by one resync, built from the
// Start's own tap: its stamp plus the whole seconds it waited until it left the queue.
describe('the resync after a late Start (ruling 2)', () => {
  /** The clock events this phone wrote to the ledger after the console's kick-off, as their stamps' seconds. */
  async function clockStamps(fakes: FakePorts) {
    return (await ledger(fakes, STARTED))
      .filter((event) => event.type === 'football.clock')
      .map((event) => (event.payload as { at: { elapsed: number } }).at.elapsed);
  }

  /** The time each append the server took was answered. */
  function acceptances(fakes: FakePorts): number[] {
    const at: number[] = [];
    const original = fakes.scoring.append.bind(fakes.scoring);
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (...args) => {
      const answer = await original(...args);
      if (answer.kind === 'accepted') at.push(Date.now());
      return answer;
    });
    return at;
  }

  it('a Start queued offline and accepted 120 s later is followed by exactly one resync, at the reading then', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    const accepted = acceptances(fakes);
    fakes.scoring.goOffline(true);
    const tapped = Date.now();
    press(view, (actions) => actions.clock());
    await flush();
    await wait(120_000);
    fakes.scoring.goOffline(false);
    await wait(20_000);
    await flush();
    const waited = Math.floor((accepted[0]! - tapped) / 1000);
    expect(waited).toBeGreaterThanOrEqual(120);
    expect(await clockStamps(fakes)).toEqual([0, waited]);
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'start',
      'resync',
    ]);
  });

  // The final review's fix-now (2026-11-08): the app dies with the Start still in the queue. The cold start reads it from
  // the queue's file, sends it, and the watch judges it from the queue's own time of the tap: one resync, by the wait.
  it('a process death with a Start still queued: after the cold start it is sent, and one resync follows', async () => {
    const first = await opened({ seed: STARTED });
    first.fakes.scoring.goOffline(true);
    const tapped = Date.now();
    press(first.view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    first.view.unmount();
    await wait(119_000);
    // The server and the queue's files outlive the app: the new ports are handed the same ones.
    const server = first.fakes.scoring;
    const fakes = createFakePorts({
      clock: timerClock,
      scoring: server,
      tapQueue: first.fakes.tapQueue,
    });
    const accepted = acceptances(first.fakes);
    server.goOffline(false);
    const { view } = await opened({ seed: STARTED, fakes });
    await wait(20_000);
    await flush();
    const waited = Math.floor((accepted[0]! - tapped) / 1000);
    expect(waited).toBeGreaterThanOrEqual(120);
    expect(await clockStamps(first.fakes)).toEqual([0, waited]);
    expect(lines(first.fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'start',
    ]);
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'resync',
    ]);
    expect(pad(view).view.sync).toEqual({ kind: 'synced' });
  });

  // The same death, but the app comes back to Home and no pad opens: Home's sender sends the Start headless, and the
  // watch is the pad's, so no resync is made (ruling 39's cost; design §7.2, final review). Other screens read it short by
  // its wait until the next clock tap.
  it('a process death with a Start still queued and no pad opened after: the Start alone is sent, with no resync', async () => {
    const first = await opened({ seed: STARTED });
    first.fakes.scoring.goOffline(true);
    press(first.view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    first.view.unmount();
    await wait(119_000);
    const server = first.fakes.scoring;
    const fakes = createFakePorts({
      clock: timerClock,
      scoring: server,
      tapQueue: first.fakes.tapQueue,
    });
    await saveScoringLink(fakes.kv, STARTED.fixtureId, LINK, HOST, 'football');
    server.goOffline(false);
    await act(async () => {
      await scoringHubOf(fakes.ports).resume();
    });
    await wait(20_000);
    await flush();
    expect(await clockStamps(first.fakes)).toEqual([0]);
    // The sender emptied the queue (an empty queue's file goes).
    expect((await fakes.tapQueue.load(STARTED.fixtureId))?.pending ?? []).toEqual([]);
    expect(lines(fakes, 'scoring.football.clock')).toEqual([]);
  });

  it('a Start accepted 2 s after its tap is followed by none', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    const accepted = acceptances(fakes);
    // The door's 429 answers the Start, and the retry 2 s on is taken.
    fakes.scoring.rateLimit(2_000);
    const tapped = Date.now();
    press(view, (actions) => actions.clock());
    await flush();
    await wait(20_000);
    expect(accepted[0]! - tapped).toBe(2_000);
    expect(await clockStamps(fakes)).toEqual([0]);
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'start',
    ]);
  });

  it('under StrictMode, whose effects run twice, a late Start is still followed by one resync', async () => {
    const { fakes, view } = await opened({ seed: STARTED, strict: true });
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(120_000);
    fakes.scoring.goOffline(false);
    await wait(20_000);
    await flush();
    expect(await clockStamps(fakes)).toHaveLength(2);
  });

  it('a Start whose answer was lost, its copy read back 120 s on, is followed by one resync at 120', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.dropNextAnswer();
    const tapped = Date.now();
    press(view, (actions) => actions.clock());
    await flush();
    fakes.scoring.goOffline(true);
    await wait(120_000);
    // The read that holds the Start's copy is the moment it leaves the queue: 120 s after its tap.
    expect(Date.now() - tapped).toBe(120_000);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(20_000);
    await flush();
    expect(await clockStamps(fakes)).toEqual([0, 120]);
    const words = lines(fakes, 'scoring.football.clock').map((line) => line.fields.action);
    expect(words).toEqual(['start', 'resync']);
  });

  it('a resync the match refuses (the organiser abandoned it meanwhile) is said in the record, and nothing is sent', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.dropNextAnswer();
    press(view, (actions) => actions.clock());
    await flush();
    fakes.scoring.goOffline(true);
    await wait(60_000);
    fakes.scoring.addOtherScorerEvent('core.abandon', { reason: 'weather' });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(20_000);
    await flush();
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields)).toEqual([
      { action: 'start', phase: 'H1' },
      { action: 'resyncRefused', phase: 'abandoned' },
    ]);
    expect(await clockStamps(fakes)).toEqual([0]);
  });

  it('a console HT standing after the Start: no resync', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.dropNextAnswer();
    press(view, (actions) => actions.clock());
    await flush();
    fakes.scoring.goOffline(true);
    await wait(60_000);
    fakes.scoring.addOtherScorerEvent('football.period', {
      phase: 'HT',
      at: { period: 'H1', elapsed: 2700 },
    });
    await wait(60_000);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(20_000);
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'start',
    ]);
    expect(await clockStamps(fakes)).toEqual([0]);
  });
});

// The controller's fix-round ruling I1 (superseding ruling 9): a running clock event after a running one in the same
// period is a clock correction on every screen, whoever sent it, and Undo takes it back alone.
describe('a resync is a clock correction (ruling I1)', () => {
  /** A Start tapped offline at 0:00 and sent 120 s later: the server records it, and the resync after it, on arrival. */
  async function lateStart(rig: Rig = {}) {
    const opened_ = await opened({ seed: STARTED, ...rig });
    const { fakes, view } = opened_;
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(120_000);
    fakes.scoring.goOffline(false);
    await wait(20_000);
    await flush();
    return opened_;
  }

  /** History's rows, oldest first, as their keys, and whether each was undone. */
  function historyRows(view: Match) {
    press(view, (actions) => actions.history());
    const { sheet } = pad(view);
    if (sheet?.kind !== 'history') throw new Error('History did not open');
    const rows = [...sheet.groups].reverse().flatMap((group) => [...group.rows].reverse());
    press(view, (actions) => actions.cancelSheet());
    return rows.map((row) => ({ key: row.said.key, undone: row.undone }));
  }

  const CLOCK_STARTED = 'scoring.football.last.clockStart';
  const CORRECTED = 'scoring.football.last.clockCorrected';

  /** The resync's stamp, as the server holds it: the Start's 0:00 plus the whole seconds it waited, 120 or more. */
  async function resyncStamp(fakes: FakePorts) {
    const clocks = (await ledger(fakes, STARTED)).filter(
      (event) => event.type === 'football.clock',
    );
    expect(clocks).toHaveLength(2);
    const stamp = (clocks[1]!.payload as { at: { period: string; elapsed: number } }).at;
    expect(stamp.period).toBe('H1');
    expect(stamp.elapsed).toBeGreaterThanOrEqual(120);
    return stamp;
  }

  it('after a late Start History shows the Start, then a correction, and the last-tap line is the correction', async () => {
    const { fakes, view } = await lateStart();
    expect(await typesOf(fakes, STARTED)).toEqual([
      'core.start',
      'football.clock',
      'football.clock',
    ]);
    expect(historyRows(view)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: CLOCK_STARTED, undone: false },
      { key: CORRECTED, undone: false },
    ]);
    expect(pad(view).display.lastTap).toEqual({
      kind: 'clockCorrect',
      at: await resyncStamp(fakes),
    });
  });

  it('across a cold start, over the server’s copies alone, it is still the Start, then a correction', async () => {
    const first = await lateStart();
    first.view.unmount();
    const fakes = createFakePorts({ clock: timerClock, scoring: first.fakes.scoring });
    const { view } = await opened({ seed: STARTED, fakes });
    expect(pad(view).display.clock.anchor?.base).toBe('server');
    expect(historyRows(view)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: CLOCK_STARTED, undone: false },
      { key: CORRECTED, undone: false },
    ]);
    expect(pad(view).display.lastTap).toEqual({
      kind: 'clockCorrect',
      at: await resyncStamp(first.fakes),
    });
  });

  it('Undo after a late Start voids only the correction: the Start stands and the clock runs from it', async () => {
    const { fakes, view } = await lateStart();
    const before = await ledger(fakes, STARTED);
    const [start, resync] = before.filter((event) => event.type === 'football.clock');
    press(view, (actions) => actions.undo());
    await flush();
    await wait(20_000);
    const after = await ledger(fakes, STARTED);
    expect(after.filter((event) => event.type === 'core.void').map((event) => event.voids)).toEqual(
      [resync!.id],
    );
    expect(pad(view).display.clock.anchor).toMatchObject({
      period: 'H1',
      elapsed: 0,
      running: true,
    });
    // The server recorded the Start on arrival: its anchor is the copy's, so the clock reads short by the wait again.
    expect(Date.parse(start!.recordedAt)).toBeGreaterThanOrEqual(T0 + 120_000);
    expect(historyRows(view)).toEqual([
      { key: 'scoring.football.last.start', undone: false },
      { key: CLOCK_STARTED, undone: false },
      { key: CORRECTED, undone: true },
    ]);
  });

  it('Undo with a goal under the resync takes back the resync alone, then the goal', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    await column(view, 'goal.first');
    await pick(view, 'dontKnow');
    await wait(118_700);
    fakes.scoring.goOffline(false);
    await wait(20_000);
    await flush();
    const before = await ledger(fakes, STARTED);
    expect(before.map((event) => event.type)).toEqual([
      'core.start',
      'football.clock',
      'football.goal',
      'football.clock',
    ]);
    press(view, (actions) => actions.undo());
    await flush();
    await wait(20_000);
    const voids = async () =>
      (await ledger(fakes, STARTED))
        .filter((event) => event.type === 'core.void')
        .map((event) => event.voids);
    expect(await voids()).toEqual([before[3]!.id]);
    expect(pad(view).display.goals).toEqual({ first: 1, second: 0 });
    press(view, (actions) => actions.undo());
    await flush();
    await wait(20_000);
    expect(await voids()).toEqual([before[3]!.id, before[2]!.id]);
    expect(pad(view).display.goals).toEqual({ first: 0, second: 0 });
  });

  it('a Correct while running reads as a correction too, and so does one while paused', async () => {
    const { view } = await opened();
    await wait(29_000);
    press(view, (actions) => actions.correct());
    await wait(300);
    press(view, (actions) => actions.step(60));
    press(view, (actions) => actions.set());
    await flush();
    await wait(1_000);
    expect(pad(view).display.lastTap).toEqual({
      kind: 'clockCorrect',
      at: { period: 'H1', elapsed: 90 },
    });
    press(view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    expect(pad(view).display.lastTap).toMatchObject({ kind: 'clock', running: false });
    press(view, (actions) => actions.correct());
    await wait(300);
    press(view, (actions) => actions.step(10));
    press(view, (actions) => actions.set());
    await flush();
    await wait(1_000);
    expect(pad(view).display.lastTap).toMatchObject({ kind: 'clockCorrect' });
  });
});

// The controller's ruling, final review (2026-11-08), through the real match hook: a Start this phone queued offline,
// overtaken by the console's own Start in the same half, is withdrawn when the phone is back. Never sent, said in the
// record, and no resync: every screen keeps the console's clock.
// Twice: another phone's link, and the organiser's console, which the web writes with no device link (N1, final re-review).
describe.each([
  ['another phone', 'addOtherScorerEvent'],
  ['the organiser’s console (no device link)', 'addConsoleEvent'],
] as const)('a Start %s overtook (final review)', (_who, writer) => {
  it('is withdrawn: never sent, the record says H1, no resync, and the phone reads the console’s clock', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    // The console's Start, 1 s after the phone's: the server records it at the time the fake's clock says now.
    const consoleStart = Date.now();
    fakes.scoring[writer]('football.clock', {
      running: true,
      at: { period: 'H1', elapsed: 0 },
    });
    await wait(600_000);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    if (pad(view).sheet?.kind === 'ask') {
      press(view, (actions) => actions.sendTaps());
      await flush();
      await wait(16_000);
    }
    expect(await typesOf(fakes, STARTED)).toEqual(['core.start', 'football.clock']);
    expect(lines(fakes, 'scoring.football.clockTapWithdrawn').map((line) => line.fields)).toEqual([
      { phase: 'H1' },
    ]);
    expect(lines(fakes, 'scoring.football.clock').map((line) => line.fields.action)).toEqual([
      'start',
    ]);
    expect(pad(view).display.clock.anchor?.base).toBe('server');
    expect(pad(view).readingNow()).toBe(Math.floor((Date.now() - consoleStart) / 1000));
  });

  // Web #1160 made only a cricket wicket's void latest-only (`assertUndoTarget`, `isCricketBall`); a football event is
  // voided freely, and the server still refuses a void of a void or of an event already undone. The phone's Undo takes
  // only its own latest standing tap with no other device's event after it, so after a withdrawal there is nothing of
  // this phone's to take back: no void is queued or sent (nothing the server could refuse).
  it('Undo after the withdrawal has nothing of this phone’s to take back: no void is sent', async () => {
    const { fakes, view } = await opened({ seed: STARTED });
    fakes.scoring.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(1_000);
    fakes.scoring[writer]('football.clock', {
      running: true,
      at: { period: 'H1', elapsed: 0 },
    });
    await wait(600_000);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    if (pad(view).sheet?.kind === 'ask') {
      press(view, (actions) => actions.sendTaps());
      await flush();
      await wait(16_000);
    }
    expect(await typesOf(fakes, STARTED)).toEqual(['core.start', 'football.clock']);
    press(view, (actions) => actions.undo());
    await flush();
    await wait(20_000);
    expect(await typesOf(fakes, STARTED)).toEqual(['core.start', 'football.clock']);
  });
});

// The controller's ruling, final review (2026-11-08): End of period re-arms 2 s after its label changes, so a second tap
// can never move the match from Half-time straight on to Full time.
describe('End of period re-arms 2 s after its label changes (final review)', () => {
  const periodTool = (view: Match) => {
    const tool = pad(view).view.tools.find((cell) => cell.id === 'period');
    return tool === undefined ? null : { key: tool.label.key, enabled: tool.enabled };
  };
  const ended = (fakes: FakePorts) =>
    lines(fakes, 'scoring.football.period').map((line) => line.fields.phase);

  it('1.9 s after Half-time it is off and a press records nothing; at 2.0 s it ends the second half', async () => {
    const { fakes, view } = await opened();
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.HT', enabled: true });
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.FT', enabled: false });
    await wait(1_900);
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.FT', enabled: false });
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect(ended(fakes)).toEqual(['HT']);
    await wait(100);
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.FT', enabled: true });
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect(ended(fakes)).toEqual(['HT', 'FT']);
    expect(await typesOf(fakes)).toEqual([
      'core.start',
      'football.clock',
      'football.period',
      'football.period',
    ]);
  });

  it('a pad opened mid-match takes End of period at once: its first drawing is no change', async () => {
    const { fakes, view } = await opened();
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.HT', enabled: true });
    press(view, (actions) => actions.tool('period'));
    await flush();
    expect(ended(fakes)).toEqual(['HT']);
  });

  it('the label going back (Half-time undone) is a change too: off for 2 s, then End of first half again', async () => {
    const { view } = await opened();
    press(view, (actions) => actions.tool('period'));
    await flush();
    await wait(2_000);
    press(view, (actions) => actions.undo());
    await flush();
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.HT', enabled: false });
    await wait(2_000);
    expect(periodTool(view)).toEqual({ key: 'scoring.football.end.HT', enabled: true });
  });
});
