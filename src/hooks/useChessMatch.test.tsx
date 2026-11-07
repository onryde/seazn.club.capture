import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chessCfg } from '@/domain/scoring/chessEngine';
import { useChessMatch } from '@/hooks/useChessMatch';
import { AWAY_ENTRANT, HOME_ENTRANT, bracketChessSeed, chessSeed } from '@/services/fakeChessPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// The chess match hook (plan S2-3 Task 3): what the pad screen is drawn from, over the real runner, hub, queue store,
// reducer and fold, and a fake server that judges with the engine alone. Copy is keys here (the screen draws the words);
// every expectation is a literal from the design (§4, §5) and the Batch A review's rulings.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const START = { type: 'core.start', payload: {} } as const;

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

/** A game another scorer started: the pad is live from the first read. */
const LIVE = chessSeed({ events: [START] });
/** The same game, the colours swapped by a pairing already on the ledger: the second player (L. Chen) holds White. */
const SWAPPED = chessSeed({
  events: [START, { type: 'boardgame.pairing', payload: { white: AWAY_ENTRANT } }],
});
/** A division that plays without colours. */
const NO_COLOURS = chessSeed({ events: [START], cfg: chessCfg({ colors: false }) });

async function rig(seed: FakeMatchSeed = LIVE): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, scoringSeed: seed });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'boardgame');
  return fakes;
}

function mount(fakes: FakePorts, seed: FakeMatchSeed = LIVE) {
  return renderHook(() => useChessMatch(seed.fixtureId), { wrapper: wrapperFor(fakes) });
}

type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useChessMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const act_ = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

/** The pad opened on a match, the first read in. */
async function opened(seed: FakeMatchSeed = LIVE) {
  const fakes = await rig(seed);
  const view = mount(fakes, seed);
  await flush();
  await wait();
  return { fakes, view };
}

/** The ledger's events, as the server holds them. */
async function ledger(fakes: FakePorts, seed: FakeMatchSeed = LIVE) {
  const events = await fakes.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const typesOf = async (fakes: FakePorts, seed?: FakeMatchSeed) =>
  (await ledger(fakes, seed)).map((event) => event.type);

/** The last event on the server's ledger. */
async function lastEvent(fakes: FakePorts, seed?: FakeMatchSeed) {
  return (await ledger(fakes, seed)).at(-1);
}

/** The sheet over the pad, narrowed to How. */
function how(view: Match) {
  const { sheet } = pad(view);
  return sheet?.kind === 'how' ? sheet : null;
}

/** A sheet opened on a half, and the wait that takes its bounce window away. */
async function openHow(view: Match, seat: 'first' | 'second' | null) {
  act_(view, (actions) => actions.choose(seat));
  await wait(300);
}

/** The line the record holds, by event name. */
const lines = (fakes: FakePorts, event: string) =>
  readRecord(fakes.record).filter((line) => line.event === event);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Start screen', () => {
  const NOT_STARTED = chessSeed();

  it('shows it for a game not started: no pick to make, no sheet, no tools', async () => {
    const { view } = await opened(NOT_STARTED);
    const model = pad(view);
    expect(model.toss).toBeNull();
    expect(model.view.start?.needsToss).toBe(false);
    expect(model.sheet).toBeNull();
    expect(model.view.tools).toEqual([]);
  });

  // The view says no side to pick; the hook must agree, or Start is enabled and fires nothing (the Task 2 review).
  it('Start queues exactly one core.start with no pick, whatever was or was not picked', async () => {
    const { fakes, view } = await opened(NOT_STARTED);
    const append = vi.spyOn(fakes.scoring, 'append');
    act_(view, (actions) => actions.start());
    await flush();
    expect(await typesOf(fakes, NOT_STARTED)).toEqual(['core.start']);
    expect((await lastEvent(fakes, NOT_STARTED))?.payload).toEqual({});
    expect(append).toHaveBeenCalledTimes(1);
    expect(pad(view).view.start).toBeNull();
  });

  it('a second Start on the heels of the first counts once', async () => {
    const { fakes, view } = await opened(NOT_STARTED);
    act(() => {
      pad(view).actions.start();
      pad(view).actions.start();
    });
    await flush();
    expect(await typesOf(fakes, NOT_STARTED)).toEqual(['core.start']);
  });
});

describe('choosing a result opens the How sheet and sends nothing', () => {
  it('a half opens it for that seat, with the decisive methods', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.tapHalf('second'));
    expect(how(view)).toEqual({
      kind: 'how',
      winner: 'second',
      picked: null,
      methods: ['checkmate', 'resign', 'time', 'adjudication', 'illegal_move'],
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start']);
  });

  it('choose(null) and the Draw tool open it for a draw, with the drawn methods', async () => {
    const { view } = await opened();
    act_(view, (actions) => actions.choose(null));
    expect(how(view)?.methods).toEqual([
      'agreement',
      'stalemate',
      'insufficient',
      'adjudication',
      'repetition',
      'fifty_move',
      'dead_position',
    ]);
    await wait(300);
    act_(view, (actions) => actions.cancelSheet());
    await wait(300);
    // The sheet is really gone before the tool is pressed: it opened nothing for the tool to be mistaken for.
    expect(pad(view).sheet).toBeNull();
    act_(view, (actions) => actions.tool('draw'));
    expect(how(view)).toMatchObject({ winner: null });
  });

  it('a tap on a half before the game starts is refused on the line, and opens nothing', async () => {
    const { fakes, view } = await opened(chessSeed());
    const append = vi.spyOn(fakes.scoring, 'append');
    act_(view, (actions) => actions.tapHalf('first'));
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notNow' });
    expect(append).not.toHaveBeenCalled();
  });

  it('a second tap on the half inside the bounce window counts once, and the line says so', async () => {
    const { view } = await opened();
    act(() => {
      pad(view).actions.tapHalf('first');
      pad(view).actions.tapHalf('second');
    });
    expect(how(view)?.winner).toBe('first');
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('a pick is shown picked; none clears it; a method of the other list is not taken', async () => {
    const { view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.pickMethod('time'));
    expect(how(view)?.picked).toBe('time');
    act_(view, (actions) => actions.pickMethod('stalemate'));
    expect(how(view)?.picked).toBe('time');
    await wait(300);
    act_(view, (actions) => actions.pickMethod(null));
    expect(how(view)?.picked).toBeNull();
  });

  it('Cancel queues nothing and leaves no sheet', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.cancelSheet());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start']);
  });

  // The second touch of a double tap on a half lands on the sheet's dim or its Cancel: it must not close what it just opened.
  it('Cancel on the heels of the half’s tap leaves the sheet open, and a later one closes it', async () => {
    const { view } = await opened();
    act(() => {
      pad(view).actions.tapHalf('first');
    });
    act_(view, (actions) => actions.cancelSheet());
    expect(how(view)).not.toBeNull();
    await wait(300);
    act_(view, (actions) => actions.cancelSheet());
    expect(pad(view).sheet).toBeNull();
  });

  // The second touch of a double tap on a close lands on what was under it: Swap colours sits at the same height as Cancel
  // and writes a pairing, so a close opens the window for every tap (the Batch B review, I1).
  describe('a sheet’s close takes the second touch of a double tap with it', () => {
    const closes: readonly [string, (view: Match) => Promise<void>][] = [
      ['Cancel', (view) => openHow(view, 'first').then(() => act_(view, (a) => a.cancelSheet()))],
      [
        'the dim',
        (view) => openHow(view, null).then(() => act_(view, (actions) => actions.cancelSheet())),
      ],
      [
        'Match details’ close',
        async (view) => {
          act_(view, (actions) => actions.details());
          await wait(300);
          act_(view, (actions) => actions.dismiss());
        },
      ],
      [
        'History’s close',
        async (view) => {
          act_(view, (actions) => actions.history());
          await wait(300);
          act_(view, (actions) => actions.dismiss());
        },
      ],
    ];

    it.each(closes)('%s: Swap colours 100 ms later writes no pairing', async (_name, close) => {
      const { fakes, view } = await opened();
      await close(view);
      expect(pad(view).sheet).toBeNull();
      await wait(100);
      act_(view, (actions) => actions.tool('swap'));
      await flush();
      expect(await typesOf(fakes)).toEqual(['core.start']);
      expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    });

    // The close must not wipe what the line said before the sheet covered the pad (AGENTS §13, an absent symptom).
    it.each([
      ['Match details', (actions: Pad['actions']) => actions.details()],
      ['History', (actions: Pad['actions']) => actions.history()],
    ])(
      '%s: a refusal on the line before it opened is still there when it closes',
      async (_name, open) => {
        const { view } = await opened();
        act_(view, (actions) => actions.undo());
        await flush();
        const refusal = pad(view).line;
        expect(refusal).toEqual({ kind: 'refusal', key: 'scoring.refusal.nothingToUndo' });
        await wait(300);
        act_(view, open);
        await wait(300);
        act_(view, (actions) => actions.dismiss());
        await flush();
        expect(pad(view).sheet).toBeNull();
        expect(pad(view).line).toEqual(refusal);
      },
    );

    it('nor does Draw 100 ms later open a sheet', async () => {
      const { view } = await opened();
      await openHow(view, 'first');
      act_(view, (actions) => actions.cancelSheet());
      await wait(100);
      act_(view, (actions) => actions.tool('draw'));
      expect(pad(view).sheet).toBeNull();
    });

    it('a Swap colours after the window writes its pairing, as it always did', async () => {
      const { fakes, view } = await opened();
      await openHow(view, 'first');
      act_(view, (actions) => actions.cancelSheet());
      await wait(300);
      act_(view, (actions) => actions.tool('swap'));
      await flush();
      expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    });
  });

  it('Back (the phone’s) closes the sheet and records nothing', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start']);
  });
});

describe('Record', () => {
  it('sends one boardgame.result for the seat, with no method when none was picked', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.record());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
    expect((await lastEvent(fakes))?.payload).toEqual({ winner: HOME_ENTRANT });
    expect(pad(view).sheet).toBeNull();
  });

  it('carries the method picked', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'second');
    act_(view, (actions) => actions.pickMethod('time'));
    act_(view, (actions) => actions.record());
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({ winner: AWAY_ENTRANT, method: 'time' });
  });

  it('records a draw as nobody, with or without a method', async () => {
    const withMethod = await opened();
    await openHow(withMethod.view, null);
    act_(withMethod.view, (actions) => actions.pickMethod('agreement'));
    act_(withMethod.view, (actions) => actions.record());
    await flush();
    expect((await lastEvent(withMethod.fakes))?.payload).toEqual({
      winner: null,
      method: 'agreement',
    });
  });

  // The seat is the player, whoever holds White: A. Sharma holds Black here, and the result names A. Sharma.
  it('names the player in the seat chosen, whoever holds White', async () => {
    const { fakes, view } = await opened(SWAPPED);
    expect(pad(view).view.halves[0].plate).toEqual({ key: 'scoring.chess.chip.black' });
    await openHow(view, 'first');
    act_(view, (actions) => actions.record());
    await flush();
    expect((await lastEvent(fakes, SWAPPED))?.payload).toEqual({ winner: HOME_ENTRANT });
  });

  it('shows the result at once: the result line, the points, the winner’s name and Undo', async () => {
    const { view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.pickMethod('checkmate'));
    act_(view, (actions) => actions.record());
    await flush();
    const { view: pv } = pad(view);
    expect(pv.tally.shown).toBe('1–0');
    expect(pv.halves.map((half) => half.value)).toEqual(['1', '0']);
    expect(pv.lastTap).toEqual({
      text: {
        key: 'scoring.chess.last.wonBy',
        vars: { name: 'A. Sharma', how: { key: 'scoring.chess.method.checkmate' } },
      },
      undo: true,
    });
  });

  // The four questions, a second call: Record leaves the screen with its tap, so a double tap lands twice on it.
  it('two Records in a row queue one event, and the line says counted once, never not now', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act(() => {
      pad(view).actions.record();
      pad(view).actions.record();
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('a Record after the sheet has gone does nothing and says nothing', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.record());
    await flush();
    await wait();
    act_(view, (actions) => actions.record());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
    expect(pad(view).line).toBeNull();
  });

  it('a double tap on the half cannot land on Record: the sheet takes no Record in the window it appears', async () => {
    const { fakes, view } = await opened();
    act(() => {
      pad(view).actions.tapHalf('first');
    });
    act_(view, (actions) => actions.record());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start']);
    expect(how(view)).not.toBeNull();
  });
});

describe('the ledger moves while the How sheet is open', () => {
  it('another scorer’s result closes it, and the display shows theirs, not this phone’s', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    fakes.scoring.addOtherScorerEvent('boardgame.result', {
      winner: AWAY_ENTRANT,
      method: 'resign',
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.tally.shown).toBe('0–1');
    expect(pad(view).view.lastTap?.undo).toBe(false);
    expect(pad(view).view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
  });

  it('another scorer’s pairing closes it: the colours it was opened under are gone', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    fakes.scoring.addOtherScorerEvent('boardgame.pairing', { white: AWAY_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.halves.map((half) => half.plate)).toEqual([
      { key: 'scoring.chess.chip.black' },
      { key: 'scoring.chess.chip.white' },
    ]);
  });

  it('the scorer chooses again after it, and the seat they pick is the player recorded', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    fakes.scoring.addOtherScorerEvent('boardgame.pairing', { white: AWAY_ENTRANT });
    fakes.realtime.ping();
    await flush();
    await wait();
    await openHow(view, 'second');
    act_(view, (actions) => actions.record());
    await flush();
    expect((await lastEvent(fakes))?.payload).toEqual({ winner: AWAY_ENTRANT });
  });

  it('an event that changes nothing it was for leaves it open', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    fakes.scoring.addOtherScorerEvent('boardgame.pairing', { white: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    expect(how(view)).not.toBeNull();
  });
});

describe('the app goes to the background with the sheet open', () => {
  it('closes it, and records nothing', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act(() => fakes.foreground.leave());
    expect(pad(view).sheet).toBeNull();
    act(() => fakes.foreground.fire());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start']);
  });

  // Subscribed only while the sheet is open (the pattern of `useBackCloses`): the runner's own listener stays.
  it('listens only while the sheet is open', async () => {
    const { fakes, view } = await opened();
    const resting = fakes.foreground.leaveListeners();
    await openHow(view, 'first');
    expect(fakes.foreground.leaveListeners()).toBe(resting + 1);
    act_(view, (actions) => actions.cancelSheet());
    expect(fakes.foreground.leaveListeners()).toBe(resting);
  });

  it('leaves Match details open: it holds no question to go stale', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.details());
    expect(pad(view).sheet?.kind).toBe('details');
    act(() => fakes.foreground.leave());
    expect(pad(view).sheet?.kind).toBe('details');
  });
});

describe('Swap colours', () => {
  it('sends one pairing naming the player who will hold White, and the plates move', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.swap());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    expect((await lastEvent(fakes))?.payload).toEqual({ white: AWAY_ENTRANT });
    expect(pad(view).view.halves.map((half) => half.plate)).toEqual([
      { key: 'scoring.chess.chip.black' },
      { key: 'scoring.chess.chip.white' },
    ]);
    expect(pad(view).view.halves.map((half) => half.label)).toEqual(['A. Sharma', 'L. Chen']);
  });

  it('a double tap writes one pairing; a swap a moment later swaps them back', async () => {
    const { fakes, view } = await opened();
    act(() => {
      pad(view).actions.swap();
      pad(view).actions.swap();
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
    await wait();
    act_(view, (actions) => actions.swap());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing', 'boardgame.pairing']);
    expect((await lastEvent(fakes))?.payload).toEqual({ white: HOME_ENTRANT });
  });

  it('is the tool of that name; the tool of any other id does nothing', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.tool('nothing'));
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start']);
    act_(view, (actions) => actions.tool('swap'));
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
  });

  it('is not offered, and sends nothing, in a division without colours', async () => {
    const { fakes, view } = await opened(NO_COLOURS);
    expect(pad(view).view.tools.map((tool) => tool.id)).toEqual(['draw']);
    expect(pad(view).view.halves.map((half) => half.plate)).toEqual([null, null]);
    act_(view, (actions) => actions.swap());
    await flush();
    expect(await typesOf(fakes, NO_COLOURS)).toEqual(['core.start']);
  });
});

describe('Undo', () => {
  /** An own result recorded, its bounce windows over. */
  async function recorded() {
    const rigged = await opened();
    await openHow(rigged.view, 'first');
    act_(rigged.view, (actions) => actions.record());
    await flush();
    await wait();
    return rigged;
  }

  it('takes this phone’s own result back: a void of it, and the pad is live again', async () => {
    const { fakes, view } = await recorded();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result', 'core.void']);
    expect(pad(view).view.tally.shown).toBe('');
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.chess.last.undone' });
  });

  it('two Undos in a row void it once', async () => {
    const { fakes, view } = await recorded();
    act(() => {
      pad(view).actions.undo();
      pad(view).actions.undo();
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result', 'core.void']);
  });

  it('leaves a result another scorer recorded alone, and queues nothing', async () => {
    const { fakes, view } = await opened();
    fakes.scoring.addOtherScorerEvent('boardgame.result', { winner: HOME_ENTRANT });
    fakes.realtime.ping();
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
    expect(pad(view).view.tally.shown).toBe('1–0');
  });

  // The generic Undo takes this phone's last tap back, which would void a swap: Undo is the result's alone (the Batch A
  // review's ruling 5), and a swap is taken back by swapping again.
  it('does not void this phone’s own swap', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.swap());
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    expect(pad(view).view.halves.map((half) => half.plate)).toEqual([
      { key: 'scoring.chess.chip.black' },
      { key: 'scoring.chess.chip.white' },
    ]);
  });

  it('does not void a swap made after a result was undone, nor the result again', async () => {
    const { fakes, view } = await recorded();
    act_(view, (actions) => actions.undo());
    await flush();
    await wait();
    act_(view, (actions) => actions.swap());
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes)).toEqual([
      'core.start',
      'boardgame.result',
      'core.void',
      'boardgame.pairing',
    ]);
  });

  it('with nothing to undo says nothing is there, and sends nothing', async () => {
    const { fakes, view } = await opened();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start']);
    expect(pad(view).line).toMatchObject({ kind: 'refusal' });
  });
});

describe('the reconnect question (owner ruling 43)', () => {
  /** This phone recorded a result offline, another scorer swapped the colours meanwhile, and the phone is back. */
  async function asked() {
    const { fakes, view } = await opened();
    fakes.scoring.goOffline(true);
    await openHow(view, 'first');
    act_(view, (actions) => actions.record());
    await flush();
    await wait();
    fakes.scoring.addOtherScorerEvent('boardgame.pairing', { white: AWAY_ENTRANT });
    fakes.scoring.goOffline(false);
    fakes.realtime.ping();
    await flush();
    await wait(16_000);
    return { fakes, view };
  }

  it('asks over the pad with the counts, and holds the result back', async () => {
    const { fakes, view } = await asked();
    expect(pad(view).sheet).toMatchObject({ kind: 'ask', ask: { foreign: 1, queued: 1 } });
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
  });

  it('a half cannot open the How sheet while the question stands', async () => {
    const { view } = await asked();
    await wait(300);
    act_(view, (actions) => actions.tapHalf('second'));
    expect(pad(view).sheet).toMatchObject({ kind: 'ask' });
  });

  it('Send my taps sends the result on the ledger as it stands, and the question goes', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act_(view, (actions) => actions.sendTaps());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing', 'boardgame.result']);
  });

  it('Discard asks again, and its confirm deletes the result: nothing of this phone’s is sent', async () => {
    const { fakes, view } = await asked();
    await wait(300);
    act_(view, (actions) => actions.askDiscard());
    expect(pad(view).sheet?.kind).toBe('discard');
    await wait(300);
    act_(view, (actions) => actions.confirmDiscard());
    await flush();
    await wait(16_000);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    expect(pad(view).view.tally.shown).toBe('');
  });
});

describe('a link that dies', () => {
  it('closes the sheet open, and the bad-link card shows', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    fakes.scoring.revoke();
    await act(async () => {
      pad(view).actions.swap();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(pad(view).view.card).toEqual({ kind: 'linkInvalid' });
    expect(pad(view).sheet).toBeNull();
  });
});

describe('the tools that are not ours', () => {
  it('a double tap on Swap through its tool counts once, and says so', async () => {
    const { fakes, view } = await opened();
    act(() => {
      pad(view).actions.tool('swap');
      pad(view).actions.tool('swap');
    });
    await flush();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.pairing']);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('a tool pressed on the heels of Record opens nothing: the second touch of a double tap', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.record());
    await flush();
    act_(view, (actions) => actions.tool('draw'));
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
  });
});

describe('the session record', () => {
  const WORD = 'scoring.chess.method';

  it('says the method chosen, as a short word, when the result is recorded', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.pickMethod('illegal_move'));
    act_(view, (actions) => actions.record());
    await flush();
    expect(lines(fakes, WORD).map((line) => line.fields)).toEqual([{ word: 'illegal_move' }]);
  });

  it('says none when no method was chosen', async () => {
    const { fakes, view } = await opened();
    await openHow(view, null);
    act_(view, (actions) => actions.record());
    await flush();
    expect(lines(fakes, WORD).map((line) => line.fields)).toEqual([{ word: 'none' }]);
  });

  it('says it once for a double tap, and never for a sheet cancelled', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.cancelSheet());
    await wait();
    expect(lines(fakes, WORD)).toEqual([]);
    await openHow(view, 'first');
    act(() => {
      pad(view).actions.record();
      pad(view).actions.record();
    });
    await flush();
    expect(lines(fakes, WORD)).toHaveLength(1);
  });

  // A Record the match refuses (the game is already decided) is no result recorded: the line is not written. The sheet's own
  // Record is held from before, as a screen that has not drawn the sheet's going yet would hold it.
  it('says nothing for a Record the match refuses', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    const stale = pad(view).actions.record;
    act(() => stale());
    await flush();
    await wait();
    expect(lines(fakes, WORD)).toHaveLength(1);
    act(() => stale());
    await flush();
    expect(lines(fakes, WORD)).toHaveLength(1);
    expect(await typesOf(fakes)).toEqual(['core.start', 'boardgame.result']);
  });

  it('names no player, no code and no link in any line', async () => {
    const { fakes, view } = await opened();
    await openHow(view, 'first');
    act_(view, (actions) => actions.pickMethod('resign'));
    act_(view, (actions) => actions.record());
    await flush();
    const everything = JSON.stringify(readRecord(fakes.record));
    for (const private_ of ['Sharma', 'Chen', FAKE_SCORING_SECRET, HOME_ENTRANT, AWAY_ENTRANT]) {
      expect(everything).not.toContain(private_);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The tie-break of a drawn knockout game (S2-3b Task 2; design §3): the Tie-break tile opens the sheet, Record sends one
// `boardgame.tiebreak` judged by the real engine on the fake server, and Undo takes it back. Expected payloads and
// advancers are the engine's (BG-KO-1, BG-KO-2), written out.
// ---------------------------------------------------------------------------------------------------------------

const DRAWN_RESULT = { type: 'boardgame.result', payload: { winner: null } } as const;
/** A bracket stage that lists every rung, the game drawn and waiting. */
const DRAWN = bracketChessSeed(undefined, { events: [START, DRAWN_RESULT] });

const tiebreakSheet = (view: Match) => {
  const { sheet } = pad(view);
  return sheet?.kind === 'tiebreak' ? sheet : null;
};

/** The Tie-break tile pressed, and the wait that takes the sheet's bounce window away. */
async function openTiebreak(view: Match) {
  act_(view, (actions) => actions.tool('tiebreak'));
  await wait(300);
}

/** One step of the sheet taken, and the wait before the next. */
async function step(view: Match, make: (actions: Pad['actions']) => void) {
  act_(view, make);
  await wait(300);
}

/** A rapid or blitz tie-break recorded through the sheet, as the scorer does it. */
async function recordTimed(
  view: Match,
  rung: 'rapid' | 'blitz',
  winner: 'first' | 'second',
  score: '2–0' | '1½–½' | null = null,
) {
  await openTiebreak(view);
  await step(view, (a) => a.pickRung(rung));
  await step(view, (a) => a.pickTiebreakWinner(winner));
  if (score !== null) await step(view, (a) => a.pickScore(score));
  act_(view, (a) => a.recordTiebreak());
  await flush();
}

describe('the Tie-break tile', () => {
  it('is the pad’s one tool while the tie-break is owed, and opens the sheet on the rung', async () => {
    const { fakes, view } = await opened(DRAWN);
    expect(pad(view).view.tools.map((tool) => tool.id)).toEqual(['tiebreak']);
    act_(view, (actions) => actions.tool('tiebreak'));
    expect(tiebreakSheet(view)).toMatchObject({
      kind: 'tiebreak',
      step: 'rung',
      rungs: ['rapid', 'blitz', 'armageddon'],
    });
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
  });

  // Both calls are in one act(): the second lands in the bounce window of the first, which is what the line says. That it
  // does not restart the sheet is `ChessPadScreen.test.tsx`'s (a second touch on the tile does not pick the first rung).
  it('a second tap on the tile in the same instant is counted once, and the line says so', async () => {
    const { view } = await opened(DRAWN);
    act(() => {
      pad(view).actions.tool('tiebreak');
      pad(view).actions.tool('tiebreak');
    });
    expect(tiebreakSheet(view)?.step).toBe('rung');
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('opens nothing for a stage that lists no rung, where the game is held for the organiser', async () => {
    const held = bracketChessSeed([], { events: [START, DRAWN_RESULT] });
    const { view } = await opened(held);
    expect(pad(view).view.tools).toEqual([]);
    act_(view, (actions) => actions.tool('tiebreak'));
    expect(pad(view).sheet).toBeNull();
  });

  it('opens nothing while the game is live (no tie-break is owed)', async () => {
    const { view } = await opened(bracketChessSeed(undefined, { events: [START] }));
    act_(view, (actions) => actions.tool('tiebreak'));
    expect(pad(view).sheet).toBeNull();
  });

  it('opens straight on the winner for a stage that lists one rung', async () => {
    const one = bracketChessSeed(['blitz'], { events: [START, DRAWN_RESULT] });
    const { view } = await opened(one);
    await openTiebreak(view);
    expect(tiebreakSheet(view)).toMatchObject({ step: 'winner', draft: { rung: 'blitz' } });
  });
});

describe('recording a rapid or blitz tie-break', () => {
  it('Rapid with a score: one boardgame.tiebreak naming the winner’s entrant, and the winner advances', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'rapid', 'second', '1½–½');
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
    expect((await lastEvent(fakes, DRAWN))?.payload).toEqual({
      rung: 'rapid',
      winner: AWAY_ENTRANT,
      score: '1½–½',
    });
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.strip).toEqual([
      {
        slot: 'note',
        text: {
          key: 'scoring.chess.tiebreak.advances',
          vars: { name: 'L. Chen', how: { key: 'scoring.chess.tiebreak.rung.rapid' } },
        },
      },
    ]);
  });

  it('Blitz with no score: the payload has no score at all', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'blitz', 'first');
    expect((await lastEvent(fakes, DRAWN))?.payload).toEqual({
      rung: 'blitz',
      winner: HOME_ENTRANT,
    });
  });

  it('keeps the game a draw: the header stays level, and the last-tap line names who advances, with Undo', async () => {
    const { view } = await opened(DRAWN);
    await recordTimed(view, 'rapid', 'first', '2–0');
    expect(pad(view).view.tally.shown).toBe('½');
    expect(pad(view).view.lastTap).toEqual({
      text: {
        key: 'scoring.chess.tiebreak.advances',
        vars: { name: 'A. Sharma', how: { key: 'scoring.chess.tiebreak.rung.rapid' } },
      },
      undo: true,
    });
    expect(pad(view).view.tools).toEqual([]);
  });

  it('a stage that lists one rung records it with two picks', async () => {
    const one = bracketChessSeed(['rapid'], { events: [START, DRAWN_RESULT] });
    const { fakes, view } = await opened(one);
    await openTiebreak(view);
    await step(view, (a) => a.pickTiebreakWinner('second'));
    act_(view, (a) => a.recordTiebreak());
    await flush();
    expect((await lastEvent(fakes, one))?.payload).toEqual({ rung: 'rapid', winner: AWAY_ENTRANT });
  });

  it('sends nothing before Record, on any step', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    await step(view, (a) => a.pickTiebreakWinner('first'));
    await step(view, (a) => a.pickScore('2–0'));
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
  });

  it('two Records in a row queue one event, and the line says counted once', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('blitz'));
    await step(view, (a) => a.pickTiebreakWinner('first'));
    act(() => {
      pad(view).actions.recordTiebreak();
      pad(view).actions.recordTiebreak();
    });
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
    expect(pad(view).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('a Record on the heels of the winner pick is the second touch of a double tap and sends nothing', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    act(() => {
      pad(view).actions.pickTiebreakWinner('first');
      pad(view).actions.recordTiebreak();
    });
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
    expect(tiebreakSheet(view)?.step).toBe('score');
  });
});

describe('recording an Armageddon', () => {
  /** Black is the second seat (L. Chen); White is A. Sharma. */
  it.each([
    ['white', HOME_ENTRANT, 'A. Sharma'],
    ['black', AWAY_ENTRANT, 'L. Chen'],
    ['draw', AWAY_ENTRANT, 'L. Chen'],
  ] as const)(
    'Black is L. Chen and the result is %s: the payload names Black and the result, never a winner, and the engine advances the right player',
    async (result, _advancer, name) => {
      const { fakes, view } = await opened(DRAWN);
      await openTiebreak(view);
      await step(view, (a) => a.pickRung('armageddon'));
      await step(view, (a) => a.pickBlack('second'));
      await step(view, (a) => a.pickArmageddonResult(result));
      expect(tiebreakSheet(view)?.step).toBe('confirm');
      act_(view, (a) => a.recordTiebreak());
      await flush();
      expect((await lastEvent(fakes, DRAWN))?.payload).toEqual({
        rung: 'armageddon',
        black: AWAY_ENTRANT,
        result,
      });
      expect(pad(view).view.lastTap?.text).toEqual({
        key: 'scoring.chess.tiebreak.advances',
        vars: { name, how: { key: 'scoring.chess.tiebreak.rung.armageddon' } },
      });
    },
  );

  // The tie-break has a colour of its own, so a division that plays without colours is asked who had Black all the same.
  it('asks who had Black in a division that plays without colours, and records it', async () => {
    const colourless = bracketChessSeed(undefined, {
      events: [START, DRAWN_RESULT],
      cfg: chessCfg({ tiebreak: true, colors: false }),
    });
    const { fakes, view } = await opened(colourless);
    expect(pad(view).view.halves.map((half) => half.plate)).toEqual([null, null]);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('armageddon'));
    expect(tiebreakSheet(view)?.step).toBe('black');
    await step(view, (a) => a.pickBlack('first'));
    await step(view, (a) => a.pickArmageddonResult('draw'));
    act_(view, (a) => a.recordTiebreak());
    await flush();
    expect((await lastEvent(fakes, colourless))?.payload).toEqual({
      rung: 'armageddon',
      black: HOME_ENTRANT,
      result: 'draw',
    });
    expect(pad(view).view.lastTap?.text).toMatchObject({ vars: { name: 'A. Sharma' } });
  });
});

describe('the tie-break sheet is closed by anything that changes what it was for', () => {
  it('Cancel and the dim send nothing and leave the tile', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    act_(view, (actions) => actions.cancelSheet());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.tools.map((tool) => tool.id)).toEqual(['tiebreak']);
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
  });

  it('Back (the phone’s) closes it and records nothing', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(pad(view).sheet).toBeNull();
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
  });

  it('the app going to the background closes it, and listens only while it is open', async () => {
    const { fakes, view } = await opened(DRAWN);
    const resting = fakes.foreground.leaveListeners();
    await openTiebreak(view);
    expect(fakes.foreground.leaveListeners()).toBe(resting + 1);
    act(() => fakes.foreground.leave());
    expect(pad(view).sheet).toBeNull();
    act(() => fakes.foreground.fire());
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(fakes.foreground.leaveListeners()).toBe(resting);
    expect(await typesOf(fakes, DRAWN)).toEqual(['core.start', 'boardgame.result']);
  });

  it('another scorer’s tie-break lands first: the sheet closes and the pad shows theirs, with no Undo', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    fakes.scoring.addOtherScorerEvent('boardgame.tiebreak', {
      rung: 'blitz',
      winner: AWAY_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.lastTap).toMatchObject({
      text: { vars: { name: 'L. Chen', how: { key: 'scoring.chess.tiebreak.rung.blitz' } } },
      undo: false,
    });
    expect(pad(view).view.tools).toEqual([]);
  });

  it('the organiser settling the game closes it', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    fakes.scoring.addOtherScorerEvent('core.settle', { winner: HOME_ENTRANT, method: 'lot' });
    fakes.realtime.ping();
    await flush();
    expect(pad(view).sheet).toBeNull();
    expect(pad(view).view.tools).toEqual([]);
  });

  // A Record for a tie-break that another scorer has already recorded says "not now" on the line and sends nothing.
  it('a Record held from before the ledger moved is refused on the line and sends nothing', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    await step(view, (a) => a.pickTiebreakWinner('first'));
    const stale = pad(view).actions.recordTiebreak;
    fakes.scoring.addOtherScorerEvent('boardgame.tiebreak', {
      rung: 'rapid',
      winner: AWAY_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    await wait();
    act(() => stale());
    await flush();
    expect(pad(view).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notNow' });
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
  });
});

describe('Undo of the tie-break', () => {
  it('voids this phone’s own tie-break, and the tile is owed again; a different one then records', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'rapid', 'first');
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
      'core.void',
    ]);
    expect(pad(view).view.tools.map((tool) => tool.id)).toEqual(['tiebreak']);
    expect(pad(view).view.lastTap?.text).toMatchObject({ key: 'scoring.chess.last.undone' });
    await wait();
    await recordTimed(view, 'blitz', 'second', '2–0');
    expect((await lastEvent(fakes, DRAWN))?.payload).toEqual({
      rung: 'blitz',
      winner: AWAY_ENTRANT,
      score: '2–0',
    });
    expect(pad(view).view.lastTap?.text).toMatchObject({ vars: { name: 'L. Chen' } });
  });

  it('two Undos in a row void it once', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'rapid', 'first');
    await wait();
    act(() => {
      pad(view).actions.undo();
      pad(view).actions.undo();
    });
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
      'core.void',
    ]);
  });

  it('does not take back a tie-break another scorer recorded', async () => {
    const { fakes, view } = await opened(DRAWN);
    fakes.scoring.addOtherScorerEvent('boardgame.tiebreak', {
      rung: 'rapid',
      winner: AWAY_ENTRANT,
    });
    fakes.realtime.ping();
    await flush();
    await wait();
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
  });

  it('closes 45 s after the tie-break, as it does for a result', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'rapid', 'first');
    expect(pad(view).view.card).toMatchObject({
      kind: 'resultRecorded',
      undoLeft: expect.any(Number),
    });
    await wait(46_000);
    expect(pad(view).view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(pad(view).view.lastTap?.undo).toBe(false);
    act_(view, (actions) => actions.undo());
    await flush();
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
  });
});

describe('the session record of a tie-break', () => {
  const EVENT = 'scoring.chess.tiebreak';

  it.each(['rapid', 'blitz'] as const)(
    'says the rung %s as one short word when it is recorded',
    async (rung) => {
      const { fakes, view } = await opened(DRAWN);
      await recordTimed(view, rung, 'first');
      expect(lines(fakes, EVENT).map((line) => line.fields)).toEqual([{ word: rung }]);
    },
  );

  it('says armageddon for an Armageddon', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('armageddon'));
    await step(view, (a) => a.pickBlack('first'));
    await step(view, (a) => a.pickArmageddonResult('white'));
    act_(view, (a) => a.recordTiebreak());
    await flush();
    expect(lines(fakes, EVENT).map((line) => line.fields)).toEqual([{ word: 'armageddon' }]);
  });

  it('says nothing for a sheet cancelled, and once for a double tap on Record', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    act_(view, (actions) => actions.cancelSheet());
    await wait();
    expect(lines(fakes, EVENT)).toEqual([]);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    await step(view, (a) => a.pickTiebreakWinner('first'));
    act(() => {
      pad(view).actions.recordTiebreak();
      pad(view).actions.recordTiebreak();
    });
    await flush();
    expect(lines(fakes, EVENT)).toHaveLength(1);
  });

  // A Record the match refuses (the tie-break is already recorded) is no tie-break recorded: the line is not written. The
  // sheet's own Record is held from before, as a screen that has not drawn the sheet's going yet would hold it.
  it('says nothing for a Record the match refuses', async () => {
    const { fakes, view } = await opened(DRAWN);
    await openTiebreak(view);
    await step(view, (a) => a.pickRung('rapid'));
    await step(view, (a) => a.pickTiebreakWinner('first'));
    const stale = pad(view).actions.recordTiebreak;
    act(() => stale());
    await flush();
    await wait();
    expect(lines(fakes, EVENT)).toHaveLength(1);
    act(() => stale());
    await flush();
    expect(lines(fakes, EVENT)).toHaveLength(1);
    expect(await typesOf(fakes, DRAWN)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
  });

  it('names no player, no entrant, no code and no link in any line', async () => {
    const { fakes, view } = await opened(DRAWN);
    await recordTimed(view, 'blitz', 'second', '2–0');
    const everything = JSON.stringify(readRecord(fakes.record));
    for (const private_ of ['Sharma', 'Chen', FAKE_SCORING_SECRET, HOME_ENTRANT, AWAY_ENTRANT]) {
      expect(everything).not.toContain(private_);
    }
  });
});
