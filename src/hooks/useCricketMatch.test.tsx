import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPick } from '@/domain/scoring/cricketPicks';
import type { CricketTap } from '@/domain/scoring/cricketTypes';
import { useCricketMatch } from '@/hooks/useCricketMatch';
import { LanguageProvider } from '@/hooks/useLanguage';
import { PortsProvider, type Ports } from '@/hooks/usePorts';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  cricketSeed,
  liveCricketSeed,
  playerOf,
} from '@/services/fakeCricketPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import {
  AWAY,
  FIRST_INNINGS_8,
  FOUR,
  HOME,
  HOME_BOWLERS,
  OUT,
  inningsOf,
  player,
  times,
  type Spec,
} from '../../test/cricketLedger';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Cricket on the pad screen's hook (S2-4 plan Task 8): the generic match over the fake server, with the real runner, queue,
// sender and fold under it (the real engine judges every event). Read only but for the three actions later tasks build
// on: record, setPicks and undo. Expected values come from the seed's ledger and the dictionary, never from the fold.

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

const LIVE = liveCricketSeed();

async function opened(seed: FakeMatchSeed = LIVE) {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'cricket');
  const view = renderHook(() => useCricketMatch(seed.fixtureId), {
    wrapper: wrapperFor(fakes),
  });
  await flush();
  await wait();
  return { fakes, view };
}

type Match = Awaited<ReturnType<typeof opened>>['view'];
type Pad = Extract<ReturnType<typeof useCricketMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

async function typesOf(fakes: FakePorts, seed: FakeMatchSeed = LIVE) {
  const events = await fakes.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
}

const home = (n: number) => playerOf(HOME_ENTRANT, n);
const away = (n: number) => playerOf(AWAY_ENTRANT, n);
const en = createTranslator('en');

/** Two run off the bat: no boundary, no extra, nobody out. */
const TWO: CricketTap = {
  kind: 'ball',
  ball: { bat: 2, extra: null, boundary: null, wicket: null },
};

describe('useCricketMatch', () => {
  it('opens on the board of the match under way: 5/0 off 0.3 overs, B. Okafor on strike', async () => {
    const { view } = await opened();
    const { board } = pad(view);
    const score = board.score;
    expect(score === null ? null : [score.runs, score.wickets, score.overs]).toEqual([5, 0, '0.3']);
    expect(
      board.crease?.map((line) => [line?.name, line?.runs, line?.balls, line?.striker]),
    ).toEqual([
      ['B. Okafor', 4, 2, true],
      ['A. Sharma', 1, 1, false],
    ]);
    expect(board.bowler?.name).toBe('W. Murphy');
    expect(board.over.chips.map((chip) => chip.text)).toEqual(['1', '4', '·']);
    // The board stands in the halves' place: nothing on the pad takes a tap of a half.
    expect(pad(view).view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('History lists a ball recorded on the console in words', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.addOtherScorerEvent('cricket.ball', {
      over: 0,
      ballInOver: 4,
      striker: home(2),
      nonStriker: home(1),
      bowler: away(11),
      runs: { bat: 2 },
    });
    fakes.realtime.ping();
    await flush();
    act(() => pad(view).actions.history());
    const sheet = pad(view).sheet;
    if (sheet?.kind !== 'history') throw new Error(`expected History, got ${sheet?.kind}`);
    const [latest] = sheet.groups;
    expect(latest === undefined ? null : translatePad(en, latest.heading)).toBe(
      'Innings 1 · Riverside CC',
    );
    const row = latest?.rows[0];
    expect(row === undefined ? null : [translatePad(en, row.said), row.score, row.by]).toEqual([
      '2 runs',
      '7/0',
      'otherScorer',
    ]);
    expect(latest?.rows.map((one) => translatePad(en, one.said))).toEqual([
      '2 runs',
      'Dot ball',
      'Four',
      '1 run',
      'Match started',
      'Riverside CC won the toss and chose to bat',
    ]);
  });

  it('record sends a ball once for a double tap, and again once the window is over', async () => {
    const { fakes, view } = await opened();
    act(() => {
      pad(view).actions.record(TWO);
      pad(view).actions.record(TWO);
    });
    await flush();
    expect(await typesOf(fakes)).toEqual([
      'cricket.toss',
      'core.start',
      'cricket.ball',
      'cricket.ball',
      'cricket.ball',
      'cricket.ball',
    ]);
    expect(pad(view).board.score?.runs).toBe(7);
    await wait();
    act(() => pad(view).actions.record(TWO));
    await flush();
    expect(pad(view).board.score?.runs).toBe(9);
    expect((await typesOf(fakes)).length).toBe(7);
  });

  it('undo takes back this phone’s own ball, and says there is nothing to undo with none of its own', async () => {
    const { fakes, view } = await opened();
    act(() => pad(view).actions.undo());
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.nothingToUndo' });
    await wait();
    act(() => pad(view).actions.record(TWO));
    await flush();
    await wait();
    act(() => pad(view).actions.undo());
    await flush();
    expect(pad(view).board.score?.runs).toBe(5);
    expect((await typesOf(fakes)).at(-1)).toBe('core.void');
  });

  it('setPicks keeps the scorer’s openers on the pad before the first ball', async () => {
    const seed = cricketSeed({
      events: [
        { type: 'cricket.toss', payload: { wonBy: AWAY_ENTRANT, elected: 'bat' } },
        { type: 'core.start', payload: {} },
      ],
    });
    const { view } = await opened(seed);
    expect(pad(view).board.crease).toBeNull();
    const { display } = pad(view);
    const picks = withPick({}, display, {
      kind: 'openers',
      striker: away(3),
      nonStriker: away(1),
    });
    act(() => pad(view).actions.setPicks(picks));
    await flush();
    expect(pad(view).board.crease?.map((line) => [line?.name, line?.striker])).toEqual([
      ['O. Kowalski', true],
      ['M. Chen', false],
    ]);
  });

  it('a match nobody has tossed for shows no score yet', async () => {
    const seed = cricketSeed();
    const { view } = await opened(seed);
    expect(pad(view).display.stage).toBe('toss');
    expect(pad(view).board.score).toBeNull();
  });
});

/** Another scorer's next ball, two run, as the console records it. */
function otherTwo(fakes: FakePorts, ballInOver = 4) {
  fakes.scoring.addOtherScorerEvent('cricket.ball', {
    over: 0,
    ballInOver,
    striker: home(2),
    nonStriker: home(1),
    bowler: away(11),
    runs: { bat: 2 },
  });
}

describe('the sheets over the board', () => {
  it('Match details opens on its icon; a Close on the heels of it is quiet, a later one closes it', async () => {
    const { view } = await opened();
    act(() => pad(view).actions.details());
    expect(pad(view).sheet?.kind).toBe('details');
    act(() => pad(view).actions.dismiss());
    expect(pad(view).sheet?.kind).toBe('details');
    await wait(300);
    act(() => pad(view).actions.dismiss());
    expect(pad(view).sheet).toBeNull();
  });

  it('Back (the phone’s) closes History and records nothing; with no sheet it is not ours', async () => {
    const { fakes, view } = await opened();
    act(() => pad(view).actions.history());
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
    expect((await typesOf(fakes)).length).toBe(5);
  });

  it('a link that dies closes the sheet open, and the bad-link card shows', async () => {
    const { fakes, view } = await opened();
    act(() => pad(view).actions.history());
    fakes.scoring.revoke();
    await act(async () => {
      pad(view).actions.record(TWO);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(pad(view).view.card).toEqual({ kind: 'linkInvalid' });
    expect(pad(view).sheet).toBeNull();
  });
});

describe('the reconnect question (owner ruling 43)', () => {
  /** This phone recorded a ball offline with History open, another scorer recorded one meanwhile, and the phone is back. */
  async function asked() {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    act(() => pad(view).actions.record(TWO));
    await flush();
    await wait();
    act(() => pad(view).actions.history());
    otherTwo(fakes);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    return { fakes, view };
  }

  it('asks over the pad with the counts, closes History under it and holds the ball back', async () => {
    const { fakes, view } = await asked();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { foreign: 1, queued: 1 } });
    expect((await typesOf(fakes)).length).toBe(6);
    act(() => pad(view).actions.history());
    expect(pad(view).sheet).toMatchObject({ kind: 'ask' });
  });

  // Plan Review Focus 1: the queued ball was the over's 4th, which the other scorer recorded first. It is a different
  // delivery, never restamped as the 5th (`cricketPayloadForSend`), so the engine refuses it, nothing of it lands, and
  // the line says so: "Not recorded — the match has moved on."
  it('Send my taps sends the ball as queued: overtaken, it is not restamped, and the question goes', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act(() => pad(view).actions.sendTaps());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect((await typesOf(fakes)).length).toBe(6);
    expect(pad(view).board.score?.runs).toBe(7);
    expect(pad(view).board.over.chips.map((chip) => chip.text)).toEqual(['1', '4', '·', '2']);
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
  });

  it('a Discard on the heels of the question appearing is quiet: the second touch of a tap made under it', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    act(() => pad(view).actions.record(TWO));
    await flush();
    await wait();
    otherTwo(fakes);
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    // Time in steps of 100 ms until the question shows: the step it shows in is inside its 250 ms window.
    for (let step = 0; step < 200 && pad(view).sheet?.kind !== 'ask'; step += 1) await wait(100);
    expect(pad(view).sheet?.kind).toBe('ask');
    act(() => pad(view).actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('ask');
    await wait(300);
    act(() => pad(view).actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
  });

  it('Discard asks again, and its confirm deletes the ball: nothing of this phone’s is sent', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act(() => pad(view).actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
    await wait(300);
    act(() => pad(view).actions.confirmDiscard());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect((await typesOf(fakes)).length).toBe(6);
    expect(pad(view).board.score?.runs).toBe(7);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The setup before the first ball (S2-4 spec §4.1, owner ruling 83; plan Task 10)
// ---------------------------------------------------------------------------------------------------------------

/** A restart: a new `Ports` over the same disk and the same server, so nothing of the launch's memory is left. */
async function reopened(fakes: FakePorts, seed: FakeMatchSeed) {
  const ports: Ports = { ...fakes.ports };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PortsProvider ports={ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    );
  }
  const view = renderHook(() => useCricketMatch(seed.fixtureId), { wrapper: Wrapper });
  await flush();
  await wait();
  return view;
}

function setupOf(view: Match) {
  const { setup } = pad(view);
  if (setup === null) throw new Error('expected the setup');
  return setup;
}

const names = (rows: readonly { readonly name: string }[]) => rows.map((row) => row.name);

async function ledgerOf(fakes: FakePorts, seed: FakeMatchSeed) {
  const events = await fakes.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const RIVERSIDE_ORDER = [
  'A. Sharma',
  'B. Okafor',
  'C. Mendes',
  'D. Walsh',
  'E. Nakamura',
  'F. Haddad',
  'G. Lindqvist',
  'H. Brennan',
  'I. Petrova',
  'J. Mwangi',
  'K. Doyle',
];

describe('the setup before the first ball (ruling 83)', () => {
  const FRESH = cricketSeed();

  /** Riverside won the toss and bats: the toss recorded and sent, its window over. */
  async function tossed() {
    const opening = await opened(FRESH);
    act(() => pad(opening.view).actions.pickTossWinner('first'));
    act(() => pad(opening.view).actions.recordToss('bat'));
    await flush();
    await wait();
    return opening;
  }

  /** Tossed, then Next on the order as it stands (A. Sharma on strike, B. Okafor), then W. Murphy to bowl. */
  async function ready() {
    const opening = await tossed();
    const { nextOpeners } = setupOf(opening.view).view;
    if (nextOpeners === null) throw new Error('expected two openers');
    act(() => pad(opening.view).actions.setOpeners(nextOpeners));
    await flush();
    await wait();
    act(() => pad(opening.view).actions.setBowler(away(11)));
    await flush();
    await wait();
    return opening;
  }

  it('the toss asks with team names, and Bat or Bowl records nothing until a team is picked', async () => {
    const { fakes, view } = await opened(FRESH);
    const setup = setupOf(view);
    expect([setup.step, setup.tossWinner]).toEqual(['toss', null]);
    expect(setup.view.teams.map((team) => team.label)).toEqual(['Riverside CC', 'Hillcrest CC']);
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    expect(await typesOf(fakes, FRESH)).toEqual([]);
    expect(setupOf(view).step).toBe('toss');
  });

  it('Bat makes the toss winner the batting side', async () => {
    const { fakes, view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('second'));
    expect(setupOf(view).tossWinner).toBe('second');
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    const [toss] = await ledgerOf(fakes, FRESH);
    expect([toss?.type, toss?.payload]).toEqual([
      'cricket.toss',
      { wonBy: AWAY_ENTRANT, elected: 'bat' },
    ]);
    const setup = setupOf(view);
    expect([setup.step, setup.view.batting?.label, setup.tossWinner]).toEqual([
      'order',
      'Hillcrest CC',
      null,
    ]);
  });

  it('a second team tap changes the pick before Bat or Bowl', async () => {
    const { fakes, view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.pickTossWinner('second'));
    act(() => pad(view).actions.recordToss('bowl'));
    await flush();
    const [toss] = await ledgerOf(fakes, FRESH);
    expect(toss?.payload).toEqual({ wonBy: AWAY_ENTRANT, elected: 'bowl' });
    expect(setupOf(view).view.batting?.label).toBe('Riverside CC');
  });

  it('the order lists starters only, Opener on the first two', async () => {
    const { view } = await tossed();
    const { order } = setupOf(view).view;
    expect(names(order)).toEqual(RIVERSIDE_ORDER);
    expect(order.map((row) => row.opener)).toEqual(RIVERSIDE_ORDER.map((_, i) => i < 2));
  });

  it('Up moves a batter and the openers follow the order', async () => {
    const { view } = await tossed();
    act(() => pad(view).actions.moveBatter(2, 1));
    await flush();
    const { order, nextOpeners } = setupOf(view).view;
    expect(names(order).slice(0, 3)).toEqual(['A. Sharma', 'C. Mendes', 'B. Okafor']);
    expect(order.slice(0, 3).map((row) => row.opener)).toEqual([true, true, false]);
    expect(nextOpeners).toEqual({ striker: home(1), nonStriker: home(3) });
  });

  it('Next picks the openers and asks the first bowler, of the fielding side', async () => {
    const { view } = await tossed();
    act(() => pad(view).actions.setOpeners({ striker: home(2), nonStriker: home(1) }));
    await flush();
    const setup = setupOf(view);
    expect(setup.step).toBe('bowler');
    expect(setup.view.openers).toEqual({
      striker: { id: home(2), name: 'B. Okafor' },
      nonStriker: { id: home(1), name: 'A. Sharma' },
    });
    expect(names(setup.view.bowlers)).toContain('W. Murphy');
    expect(names(setup.view.bowlers)).not.toContain('A. Sharma');
  });

  it('Back from the bowler shows the order again; Next there asks the bowler again, the pick kept', async () => {
    const { view } = await ready();
    await wait();
    act(() => pad(view).actions.changeOrder());
    expect([setupOf(view).step, setupOf(view).ready]).toEqual(['order', true]);
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    expect(setupOf(view).step).toBe('ready');
    expect(
      setupOf(view)
        .view.bowlers.filter((row) => row.chosen)
        .map((row) => row.name),
    ).toEqual(['W. Murphy']);
  });

  it('Start match waits for openers and a bowler', async () => {
    const { fakes, view } = await tossed();
    expect(setupOf(view).ready).toBe(false);
    act(() => pad(view).actions.start());
    await flush();
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    await wait();
    expect(setupOf(view).ready).toBe(false);
    act(() => pad(view).actions.start());
    await flush();
    await wait();
    expect(await typesOf(fakes, FRESH)).toEqual(['cricket.toss']);
    act(() => pad(view).actions.setBowler(away(11)));
    await flush();
    await wait();
    expect([setupOf(view).step, setupOf(view).ready]).toEqual(['ready', true]);
    act(() => pad(view).actions.start());
    await flush();
    expect(await typesOf(fakes, FRESH)).toEqual(['cricket.toss', 'core.start']);
    expect(pad(view).setup).toBeNull();
  });

  it('a second tap on Start records one start', async () => {
    const { fakes, view } = await ready();
    act(() => {
      pad(view).actions.start();
      pad(view).actions.start();
    });
    await flush();
    expect(await typesOf(fakes, FRESH)).toEqual(['cricket.toss', 'core.start']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('the first ball carries the openers and the bowler', async () => {
    const { fakes, view } = await ready();
    act(() => pad(view).actions.start());
    await flush();
    await wait();
    act(() => pad(view).actions.record(TWO));
    await flush();
    const ball = (await ledgerOf(fakes, FRESH)).at(-1);
    expect(ball?.type).toBe('cricket.ball');
    expect(ball?.payload).toMatchObject({
      over: 0,
      ballInOver: 1,
      striker: home(1),
      nonStriker: home(2),
      bowler: away(11),
    });
  });

  it('a reopened match keeps the batting order and the bowler pick', async () => {
    const { fakes, view } = await tossed();
    act(() => pad(view).actions.moveBatter(2, 1));
    await flush();
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(3) }));
    await flush();
    await wait();
    act(() => pad(view).actions.setBowler(away(10)));
    await flush();
    await wait();
    view.unmount();
    await flush();
    const again = await reopened(fakes, FRESH);
    const setup = setupOf(again);
    expect(setup.step).toBe('ready');
    expect(names(setup.view.order).slice(0, 3)).toEqual(['A. Sharma', 'C. Mendes', 'B. Okafor']);
    expect(setup.view.openers?.nonStriker.name).toBe('C. Mendes');
    expect(setup.view.bowlers.filter((row) => row.chosen).map((row) => row.name)).toEqual([
      'V. Kaur',
    ]);
  });

  it('a reopened match before Bat or Bowl asks the toss again: the winner was in memory only', async () => {
    const { fakes, view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    view.unmount();
    await flush();
    const again = await reopened(fakes, FRESH);
    expect([setupOf(again).step, setupOf(again).tossWinner]).toEqual(['toss', null]);
  });

  it('Undo of the toss asks the toss again, with no team held', async () => {
    const { fakes, view } = await tossed();
    act(() => pad(view).actions.undo());
    await flush();
    await wait();
    expect([setupOf(view).step, setupOf(view).tossWinner]).toEqual(['toss', null]);
    expect((await typesOf(fakes, FRESH)).at(-1)).toBe('core.void');
  });

  it('a match under way shows no setup', async () => {
    const { view } = await opened();
    expect(pad(view).setup).toBeNull();
  });
});

describe('the setup, a second touch (the bounce window)', () => {
  const FRESH = cricketSeed();

  it('a move on the heels of the toss is the second touch of Bat: counted once, the order unchanged', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 2)).toEqual(['A. Sharma', 'B. Okafor']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 2)).toEqual(['B. Okafor', 'A. Sharma']);
  });

  it('Next on the heels of the toss is the second touch: no openers', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    expect(setupOf(view).step).toBe('order');
  });

  it('a bowler on the heels of Next is the second touch: no bowler', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    act(() => pad(view).actions.setBowler(away(11)));
    await flush();
    expect(setupOf(view).step).toBe('bowler');
    await wait();
    act(() => pad(view).actions.setBowler(away(11)));
    await flush();
    expect(setupOf(view).step).toBe('ready');
  });

  // Batch 3 fix round 1, M2: Back stands in the same foot as Next, so the second touch of a double tap on Next lands on it.
  it('Back on the heels of Next is the second touch: the bowler is still asked', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    act(() => pad(view).actions.changeOrder());
    expect(setupOf(view).step).toBe('bowler');
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act(() => pad(view).actions.changeOrder());
    expect(setupOf(view).step).toBe('order');
  });

  // Batch 3 fix round 1, M3: a move is a tap of its own (the kit's rule: the same tap again inside the window counts
  // once). A double tap on ▲ of a row moves its batter up once; the second touch, on the ▲ of the batter who slid into
  // that row, is the same control and would put them back.
  it('a double tap on ▲ moves its batter once: the second touch is counted once, the order as the first left it', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 2)).toEqual(['B. Okafor', 'A. Sharma']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 2)).toEqual(['A. Sharma', 'B. Okafor']);
  });

  it('a move of another row on the heels of a move counts: it is another control', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    act(() => pad(view).actions.moveBatter(3, 2));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 4)).toEqual([
      'B. Okafor',
      'A. Sharma',
      'D. Walsh',
      'C. Mendes',
    ]);
  });

  it('a pick on the heels of Back is the second touch: the order unchanged', async () => {
    const { view } = await opened(FRESH);
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: home(1), nonStriker: home(2) }));
    await flush();
    await wait();
    act(() => pad(view).actions.changeOrder());
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(names(setupOf(view).view.order).slice(0, 2)).toEqual(['A. Sharma', 'B. Okafor']);
  });
});

// Batch 4 dispatch (carried from the Batch 3 review): a ▲▼ move is a choice the phone keeps, not news. A failure standing
// on the line ("Couldn't save your choice", the disk refusing the picks twice) stays until a save lands (AGENTS §6): the
// move must not clear it, and the save that lands with the held choice does.
describe('a ▲▼ move and a choice the disk refused', () => {
  it('a move leaves “Couldn’t save your choice” standing until a save lands, which clears it', async () => {
    const { fakes, view } = await opened(cricketSeed());
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    await wait();
    const real = fakes.tapQueue.saveBoot.bind(fakes.tapQueue);
    let land: () => void = () => undefined;
    vi.spyOn(fakes.tapQueue, 'saveBoot')
      .mockRejectedValueOnce(new Error('the disk refused'))
      .mockRejectedValueOnce(new Error('the disk refused'))
      .mockImplementationOnce(
        (fixtureId, cache) =>
          new Promise<void>((resolve, reject) => {
            land = () => void real(fixtureId, cache).then(resolve, reject);
          }),
      );
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    const refused = { kind: 'refusal', key: 'scoring.refusal.choiceNotSaved' };
    expect(pad(view).line).toEqual(refused);
    await wait();
    act(() => pad(view).actions.moveBatter(3, 2));
    await flush();
    // The move is made and on screen; its save has not landed, so the failure still stands.
    expect(names(setupOf(view).view.order).slice(0, 4)).toEqual([
      'B. Okafor',
      'A. Sharma',
      'D. Walsh',
      'C. Mendes',
    ]);
    expect(pad(view).line).toEqual(refused);
    land();
    await flush();
    expect(pad(view).line).toBeNull();
  });
});

// The innings break, the super over and the result (S2-4 spec §4.5 to §4.7; plan Task 16), on the ledger fixtures'
// sides ("Home CC", "Away CC"): this phone records the ball that ends an innings or the match, and the break's setup
// stands in the board's place until Start innings, which records nothing.
describe('the innings break and the result (Task 16)', () => {
  const H = (n: number) => player('H', n);
  const A = (n: number) => player('A', n);

  /** A match on the fixtures' sides, the ledger as the specs say (the browser's). */
  const seedOf = (specs: readonly Spec[]): FakeMatchSeed => ({
    ...cricketSeed({ events: specs.map(({ type, payload }) => ({ type, payload })) }),
    sides: { home: HOME, away: AWAY },
  });

  /** The home side's innings one ball short: 8/0 off 1.5 overs, the last ball (a dot) is this phone's to record. */
  const LAST_BALL_DUE = seedOf(FIRST_INNINGS_8.slice(0, -1));

  /** The away side chasing 9: 8/6 off 1.2 overs, the next ball (a single) wins it by 4 wickets. */
  const WINNING_BALL_DUE = seedOf([
    ...FIRST_INNINGS_8,
    ...inningsOf('A', HOME_BOWLERS, [...times(6, OUT), FOUR, FOUR]),
  ]);

  /** This phone's dot ends the first innings: the break stands, a second on. */
  async function atTheBreak() {
    const opening = await opened(LAST_BALL_DUE);
    act(() => pad(opening.view).actions.run(0));
    await flush();
    await wait();
    return opening;
  }

  /** At the break with the openers (A-p1 on strike, A-p2) and H-p11 to bowl picked. */
  async function setUp() {
    const opening = await atTheBreak();
    act(() => pad(opening.view).actions.setOpeners({ striker: A(1), nonStriker: A(2) }));
    await flush();
    await wait();
    act(() => pad(opening.view).actions.setBowler(H(11)));
    await flush();
    await wait();
    return opening;
  }

  const said = (text: Parameters<typeof translatePad>[1] | null | undefined) =>
    text === null || text === undefined ? null : translatePad(en, text);

  it('the break stands in the board’s place with its card, asking the openers of the side batting next', async () => {
    const { view } = await atTheBreak();
    expect(pad(view).display.stage).toBe('break');
    const setup = setupOf(view);
    expect([setup.step, setup.begins, setup.view.batting?.label]).toEqual([
      'openers',
      'innings',
      'Away CC',
    ]);
    expect([said(setup.card?.title), said(setup.card?.line)]).toEqual([
      'Innings break',
      'Home CC 8/0 (2 ov) · Away CC need 9 off 12 balls',
    ]);
  });

  it('before the match’s first ball the setup starts the match, with no break card', async () => {
    const { view } = await opened(cricketSeed());
    act(() => pad(view).actions.pickTossWinner('first'));
    act(() => pad(view).actions.recordToss('bat'));
    await flush();
    expect([setupOf(view).begins, setupOf(view).card]).toEqual(['match', null]);
  });

  // Back, then Next: the order's Next stands where Start innings will, so its second touch lands there.
  it('Start innings on the heels of Next is the second touch: nothing starts', async () => {
    const { view } = await setUp();
    act(() => pad(view).actions.changeOrder());
    await wait();
    act(() => pad(view).actions.setOpeners({ striker: A(1), nonStriker: A(2) }));
    await flush();
    expect(setupOf(view).step).toBe('ready');
    act(() => pad(view).actions.startInnings());
    await flush();
    expect(pad(view).display.stage).toBe('break');
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act(() => pad(view).actions.startInnings());
    await flush();
    expect(pad(view).display.stage).toBe('live');
  });

  it('Start innings queues nothing', async () => {
    const { fakes, view } = await setUp();
    expect(setupOf(view).ready).toBe(true);
    const before = await ledgerOf(fakes, LAST_BALL_DUE);
    const queue = await fakes.tapQueue.load(LAST_BALL_DUE.fixtureId);
    const line = pad(view).line;
    act(() => pad(view).actions.startInnings());
    await flush();
    expect(await ledgerOf(fakes, LAST_BALL_DUE)).toEqual(before);
    expect(await fakes.tapQueue.load(LAST_BALL_DUE.fixtureId)).toEqual(queue);
    expect(queue?.pending).toEqual([]);
    expect(pad(view).line).toEqual(line);
    expect([pad(view).setup, pad(view).display.stage]).toEqual([null, 'live']);
  });

  it('the chase’s first ball carries the openers and the bowler', async () => {
    const { fakes, view } = await setUp();
    act(() => pad(view).actions.startInnings());
    await flush();
    await wait();
    act(() => pad(view).actions.run(1));
    await flush();
    const ball = (await ledgerOf(fakes, LAST_BALL_DUE)).at(-1);
    expect([ball?.type, ball?.payload]).toMatchObject([
      'cricket.ball',
      { over: 0, ballInOver: 1, striker: A(1), nonStriker: A(2), bowler: H(11) },
    ]);
  });

  it('Start innings waits for the openers and the bowler', async () => {
    const { view } = await atTheBreak();
    act(() => pad(view).actions.startInnings());
    await flush();
    await wait();
    expect([pad(view).display.stage, setupOf(view).step]).toEqual(['break', 'openers']);
    act(() => pad(view).actions.setOpeners({ striker: A(1), nonStriker: A(2) }));
    await flush();
    await wait();
    act(() => pad(view).actions.startInnings());
    await flush();
    await wait();
    expect([pad(view).display.stage, setupOf(view).step]).toEqual(['break', 'bowler']);
    // Nothing of those early taps is kept: the bowler's pick leaves the break standing until Start innings.
    act(() => pad(view).actions.setBowler(H(11)));
    await flush();
    await wait();
    expect([pad(view).display.stage, setupOf(view).step]).toEqual(['break', 'ready']);
  });

  it('a double tap on Start innings is one: the second touch lands on the keys and records nothing', async () => {
    const { fakes, view } = await setUp();
    const before = (await ledgerOf(fakes, LAST_BALL_DUE)).length;
    act(() => pad(view).actions.startInnings());
    await flush();
    act(() => pad(view).actions.run(1));
    await flush();
    expect((await ledgerOf(fakes, LAST_BALL_DUE)).length).toBe(before);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  // The thumb that lifted off the innings' last key lands on the setup now in the board's place: ▲▼, Next, a bowler and
  // Start innings take nothing for the 250 ms of the break appearing, and say nothing.
  it('the setup’s controls on the heels of the innings’ last ball take nothing', async () => {
    const { view } = await opened(LAST_BALL_DUE);
    act(() => pad(view).actions.run(0));
    await flush();
    const line = pad(view).line;
    act(() => pad(view).actions.moveBatter(1, 0));
    act(() => pad(view).actions.setOpeners({ striker: A(1), nonStriker: A(2) }));
    await flush();
    expect(
      setupOf(view)
        .view.order.slice(0, 2)
        .map((row) => row.id),
    ).toEqual([A(1), A(2)]);
    expect(setupOf(view).step).toBe('openers');
    expect(pad(view).line).toEqual(line);
    await wait();
    act(() => pad(view).actions.moveBatter(1, 0));
    await flush();
    expect(
      setupOf(view)
        .view.order.slice(0, 2)
        .map((row) => row.id),
    ).toEqual([A(2), A(1)]);
  });

  // The picks for the next innings outlive an Undo of the ball that ended this one, so the break comes back on the step
  // they left: the bowler, then Start innings, each in the moment of the break appearing.
  it('a bowler and Start innings on the heels of the break appearing take nothing', async () => {
    const { view } = await atTheBreak();
    act(() => pad(view).actions.setOpeners({ striker: A(1), nonStriker: A(2) }));
    await flush();
    await wait();
    const again = async () => {
      act(() => pad(view).actions.undo());
      await flush();
      await wait();
      expect(pad(view).display.stage).toBe('live');
      act(() => pad(view).actions.run(0));
      await flush();
    };
    await again();
    act(() => pad(view).actions.setBowler(H(11)));
    await flush();
    expect([pad(view).display.stage, setupOf(view).step]).toEqual(['break', 'bowler']);
    await wait();
    act(() => pad(view).actions.setBowler(H(11)));
    await flush();
    await wait();
    expect(setupOf(view).step).toBe('ready');
    await again();
    act(() => pad(view).actions.startInnings());
    await flush();
    expect([pad(view).display.stage, setupOf(view).step]).toEqual(['break', 'ready']);
    await wait();
    act(() => pad(view).actions.startInnings());
    await flush();
    expect(pad(view).display.stage).toBe('live');
  });

  it('Undo across the innings break returns to the last ball of innings 1', async () => {
    const { fakes, view } = await atTheBreak();
    act(() => pad(view).actions.undo());
    await flush();
    expect([pad(view).display.stage, pad(view).setup]).toEqual(['live', null]);
    const score = pad(view).board.score;
    expect([score?.runs, score?.wickets, score?.overs, said(score?.innings)]).toEqual([
      8,
      0,
      '1.5',
      'Innings 1 · Home CC',
    ]);
    expect(pad(view).board.bowler?.id).toBe(A(10));
    expect((await typesOf(fakes, LAST_BALL_DUE)).at(-1)).toBe('core.void');
  });

  it('Undo of the innings’ last ball after Start innings returns to it as well', async () => {
    const { view } = await setUp();
    act(() => pad(view).actions.startInnings());
    await flush();
    await wait();
    act(() => pad(view).actions.undo());
    await flush();
    const score = pad(view).board.score;
    expect([score?.runs, score?.overs, said(score?.innings)]).toEqual([
      8,
      '1.5',
      'Innings 1 · Home CC',
    ]);
  });

  it('Undo of the deciding ball inside 45 s reopens; after, it does not', async () => {
    const { fakes, view } = await opened(WINNING_BALL_DUE);
    act(() => pad(view).actions.run(1));
    await flush();
    await wait();
    expect(pad(view).display.stage).toBe('decided');
    expect(said(pad(view).view.strip[0]?.text)).toBe('Away CC won by 4 wickets');
    expect(pad(view).view.card).toMatchObject({
      kind: 'resultRecorded',
      undoLeft: expect.any(Number),
    });
    act(() => pad(view).actions.undo());
    await flush();
    expect([pad(view).display.stage, pad(view).display.result]).toEqual(['live', null]);
    expect(pad(view).board.score?.runs).toBe(8);
    await wait();
    act(() => pad(view).actions.run(1));
    await flush();
    await wait(46_000);
    expect(pad(view).view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(pad(view).view.lastTap?.undo).toBe(false);
    const before = await typesOf(fakes, WINNING_BALL_DUE);
    act(() => pad(view).actions.undo());
    await flush();
    expect(await typesOf(fakes, WINNING_BALL_DUE)).toEqual(before);
    expect(pad(view).display.stage).toBe('decided');
  });

  it('a decided match shows no setup and no break card', async () => {
    const { view } = await opened(WINNING_BALL_DUE);
    act(() => pad(view).actions.run(1));
    await flush();
    expect(pad(view).setup).toBeNull();
  });
});
