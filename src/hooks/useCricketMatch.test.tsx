import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPick } from '@/domain/scoring/cricketPicks';
import type { CricketTap } from '@/domain/scoring/cricketTypes';
import { useCricketMatch } from '@/hooks/useCricketMatch';
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
    expect(board.crease?.map((line) => [line.name, line.runs, line.balls, line.striker])).toEqual([
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
    expect(pad(view).board.crease?.map((line) => [line.name, line.striker])).toEqual([
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
