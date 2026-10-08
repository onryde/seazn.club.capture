import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { DeliveryWord } from '@/domain/session/viewerFeed';
import { FIRST_WINDOW_PATIENCE_MS } from '@/domain/session/viewerFeed';
import type { Telemetry } from '@/engine/CaptureEnginePort';
import { PLAYER_RETRY_MS } from '@/hooks/useViewerFeed';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { createLogger } from '@/services/logger';
import { createNativeSurfaces } from '@/services/native/nativeSurfaces';
import { createRingRecord } from '@/services/sessionRecord';
import { fakeVideo } from '../../test/fakeExpoVideo';
import { readRecord } from '../../test/fakePorts';
import { createFakeSurfaces } from '../../test/fakeSurfaces';
import { pressIn, pressOut } from '../../test/press';
import { renderViewfinder } from '../../test/renderViewfinder';

type View = Awaited<ReturnType<typeof renderViewfinder>>;

const peek = () => screen.getByRole('button', { name: 'What viewers see' });
const note = () => screen.queryByTestId('viewer-note')?.textContent ?? null;
const video = () => screen.queryByTestId('viewer-video');
const WAITING = en['stream.peek.loading'];
const NONE = en['stream.peek.unavailable'];

/**
 * On air, the native word saying no window has been seen yet. One act, because the fake's `live` scene
 * carries `delivery: ok` and the viewer layer reads the engine whether or not the peek is held: a
 * separate act would render that `ok` and latch the window before the test begins.
 */
function goLiveWithoutWindow(view: View) {
  act(() => {
    view.engine.scene('live');
    view.engine.patch({ delivery: 'unknown', deliveredLagMs: null });
  });
}

/** The first window lands: native's delivery watch reads the manifest. */
const windowLands = (view: View) =>
  act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));

async function liveWithoutWindow() {
  const view = await renderViewfinder();
  goLiveWithoutWindow(view);
  return view;
}

/** Time moves on the phone's clock port AND the timers: the hook reads the one and waits on the other. */
function advance(view: View, ms: number) {
  view.setNow(new Date(view.ports.clock().getTime() + ms));
  act(() => vi.advanceTimersByTime(ms));
}

/** A player that fails, waits its schedule, and is replaced: the number of mounts after each wait. */
function failAndWait(view: View, index: number) {
  const wait = PLAYER_RETRY_MS[index] ?? Number.NaN;
  act(() => view.surfaces.videoStatus('failed'));
  act(() => vi.advanceTimersByTime(wait - 1));
  const before = view.surfaces.videoMounts();
  act(() => vi.advanceTimersByTime(1));
  return { before, after: view.surfaces.videoMounts() };
}

/** Live, a window, the peek held, and every retry spent: the layer has given up on the player. */
async function givenUp() {
  const view = await liveWithoutWindow();
  pressIn(peek());
  windowLands(view);
  for (const index of PLAYER_RETRY_MS.keys()) failAndWait(view, index);
  act(() => view.surfaces.videoStatus('failed'));
  return view;
}

const lines = (view: View, event: string) =>
  readRecord(view.record).filter((line) => line.event === event);

describe('the viewer layer (spec §9, D6 to D8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the type matches native’s delivery word', () => {
    expectTypeOf<DeliveryWord>().toEqualTypeOf<Telemetry['delivery']>();
  });

  it('M26a before the first window it says so and mounts no player, so nothing is blank', async () => {
    const view = await liveWithoutWindow();
    // The set-up is what the test claims: no window was ever read.
    expect(lines(view, 'peek.firstWindow')).toHaveLength(0);
    pressIn(peek());
    expect(note()).toBe(WAITING);
    expect(video()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(0);
  });

  it('plays the moment the first window lands, loading until the player says ready, and records the time', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, 19_000);
    windowLands(view);
    expect(video()?.dataset.playing).toBe('true');
    expect(note()).toBe(WAITING);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    const first = lines(view, 'peek.firstWindow');
    expect(first).toHaveLength(1);
    expect(first[0]?.fields).toEqual({ ms: 19_000 });
  });

  it('R3 opening the viewfinder on a broadcast already delivering records no first window: it did not see the start', async () => {
    const view = await renderViewfinder(
      {},
      { strict: true, prepare: (fakes) => fakes.engine.scene('live') },
    );
    // The set-up is what the test claims: on air, the window already there, and a player offered.
    expect(view.ports.engine.getSnapshot().telemetry.delivery).toBe('ok');
    pressIn(peek());
    expect(video()).toBeTruthy();
    windowLands(view);
    act(() => vi.advanceTimersByTime(5_000));
    expect(lines(view, 'peek.firstWindow')).toHaveLength(0);
  });

  it('M26d the first window is recorded once, however the kind flips afterwards', async () => {
    const view = await renderViewfinder({}, { strict: true });
    goLiveWithoutWindow(view);
    advance(view, 7_000);
    windowLands(view);
    act(() => {
      view.engine.forceState({
        kind: 'degraded',
        transport: 'srt',
        reason: 'poor-uplink',
        sinceEpochMs: 1,
      });
      view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 });
    });
    act(() => view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }));
    expect(lines(view, 'peek.firstWindow').map((line) => line.fields)).toEqual([{ ms: 7_000 }]);
  });

  it('M27 the patience is 60 s exactly, then says no picture, and a later window still recovers', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, FIRST_WINDOW_PATIENCE_MS - 1);
    expect(note()).toBe(WAITING);
    advance(view, 1);
    expect(note()).toBe(NONE);
    expect(video()).toBeNull();
    windowLands(view);
    expect(video()).toBeTruthy();
  });

  it('M27b the patience counts from the stretch, so a hold starts it again from nothing', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, FIRST_WINDOW_PATIENCE_MS - 1_000);
    act(() => view.engine.scene('holding'));
    goLiveWithoutWindow(view);
    advance(view, FIRST_WINDOW_PATIENCE_MS - 1_000);
    expect(note()).toBe(WAITING);
    advance(view, 1_000);
    expect(note()).toBe(NONE);
  });

  it('M27c a hold after the patience ran out gives the next stretch its patience back', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, FIRST_WINDOW_PATIENCE_MS);
    expect(note()).toBe(NONE);
    act(() => view.engine.scene('holding'));
    goLiveWithoutWindow(view);
    expect(note()).toBe(WAITING);
    advance(view, FIRST_WINDOW_PATIENCE_MS);
    expect(note()).toBe(NONE);
  });

  it('M28 one failed poll after the first window keeps playing', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
    expect(video()).toBeTruthy();
    expect(view.surfaces.videoMounts()).toBe(1);
  });

  it('M29 a hold unmounts the player, and the way back waits for a fresh window', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(1);
    act(() => view.engine.scene('holding'));
    expect(video()).toBeNull();
    expect(note()).toBe(NONE);
    goLiveWithoutWindow(view);
    expect(note()).toBe(WAITING);
    expect(video()).toBeNull();
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    // The stretch after a hold began on this screen, so its first window is recorded too.
    expect(lines(view, 'peek.firstWindow')).toHaveLength(2);
  });

  it('native’s stalled word is no picture, with no player', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('not-delivered'));
    pressIn(peek());
    expect(note()).toBe(NONE);
    expect(video()).toBeNull();
  });

  it('a window that stalls and comes back plays again from a fresh player', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(note()).toBe(NONE);
    expect(video()).toBeNull();
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBe(WAITING);
  });

  it('M30 a failing player is retried on the schedule with a fresh player, then given up on', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    let rungs = 0;
    for (const index of PLAYER_RETRY_MS.keys()) {
      expect(failAndWait(view, index)).toEqual({ before: index + 1, after: index + 2 });
      rungs += 1;
    }
    expect(rungs).toBe(PLAYER_RETRY_MS.length);
    act(() => view.surfaces.videoStatus('failed'));
    expect(video()).toBeNull();
    expect(note()).toBe(NONE);
    expect(PLAYER_RETRY_MS).toHaveLength(3);
    // The record says which retry each was, in order, and nothing else.
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual(
      [...PLAYER_RETRY_MS.keys()].map((attempt) => ({ attempt })),
    );
  });

  it('M30c once given up it stays given up: a minute later it is still unavailable, with no new player', async () => {
    const view = await givenUp();
    const mounts = view.surfaces.videoMounts();
    expect(mounts).toBe(PLAYER_RETRY_MS.length + 1);
    expect(note()).toBe(NONE);
    for (let second = 0; second < 60; second += 1) act(() => vi.advanceTimersByTime(1_000));
    expect(note()).toBe(NONE);
    expect(video()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(mounts);
    expect(lines(view, 'peek.retry')).toHaveLength(PLAYER_RETRY_MS.length);
  });

  it('M30d two failed reports from one player are one failure, not two', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    const wait = PLAYER_RETRY_MS[0] ?? Number.NaN;
    act(() => view.surfaces.videoStatus('failed'));
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(wait));
    expect(view.surfaces.videoMounts()).toBe(2);
    // The next failure is the SECOND rung (4 s), not the third.
    const next = failAndWait(view, 1);
    expect(next).toEqual({ before: 2, after: 3 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      { attempt: 0 },
      { attempt: 1 },
    ]);
  });

  it('M30e a player that fails after it was ready is waiting again while its replacement loads', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    act(() => view.surfaces.videoStatus('failed'));
    expect(note()).toBe(WAITING);
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBe(WAITING);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
  });

  /**
   * Every state that ends a stretch gives the player its full schedule back. A hold is `reconnecting`;
   * a new broadcast passes through one of the four resting kinds (D7). The player's OWN failure is not
   * one of them (M30c).
   */
  it('M30f a hold, or any resting kind, forgets a give-up, and the schedule starts again from its first wait', async () => {
    const resting: readonly (readonly [string, SessionState])[] = [
      [
        'a hold',
        {
          kind: 'reconnecting',
          cause: 'uplink-lost',
          holdRemainingSeconds: 30,
          holdWindowSeconds: 60,
          sinceEpochMs: 1,
        },
      ],
      ['idle', { kind: 'idle' }],
      ['pairing', { kind: 'pairing' }],
      ['paired', { kind: 'paired' }],
      ['ended', { kind: 'ended', reason: 'operator-stopped', durationMs: null }],
    ];
    let rows = 0;
    for (const [name, state] of resting) {
      const view = await givenUp();
      const mounts = view.surfaces.videoMounts();
      act(() => view.engine.forceState(state));
      expect({ name, note: note() }).toEqual({ name, note: name === 'a hold' ? NONE : null });
      // The way back, in one act (a forced state brings its own `ok`): native has seen no window yet.
      act(() => {
        view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
        view.engine.patch({ delivery: 'unknown', deliveredLagMs: null });
      });
      // What the layer decided, read from the record: a resting kind let go of the peek, and the finger
      // landing again would itself try again (R1), so the forgetting is judged before it does.
      const decided = () => lines(view, 'peek.state').at(-1)?.fields.state;
      expect({ name, decided: decided() }).toEqual({ name, decided: 'waiting' });
      windowLands(view);
      expect({ name, decided: decided() }).toEqual({ name, decided: 'playing' });
      pressIn(peek());
      expect({ name, mounts: view.surfaces.videoMounts(), note: note() }).toEqual({
        name,
        mounts: mounts + 1,
        note: WAITING,
      });
      // A first failure waits the FIRST rung again: one retry, not a give-up.
      expect({ name, ...failAndWait(view, 0) }).toEqual({
        name,
        before: mounts + 1,
        after: mounts + 2,
      });
      view.unmount();
      rows += 1;
    }
    expect(rows).toBe(5);
  });

  it('R1 a press after the give-up tries again with a fresh player, from the first wait', async () => {
    const view = await givenUp();
    const mounts = view.surfaces.videoMounts();
    expect(note()).toBe(NONE);
    pressOut(peek());
    pressIn(peek());
    expect(view.surfaces.videoMounts()).toBe(mounts + 1);
    expect(note()).toBe(WAITING);
    expect(failAndWait(view, 0)).toEqual({ before: mounts + 1, after: mounts + 2 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      ...[...PLAYER_RETRY_MS.keys()].map((attempt) => ({ attempt })),
      { attempt: 0 },
    ]);
  });

  it('R1b a press while the player is healthy, or its replacement is on the way, changes nothing', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    pressOut(peek());
    pressIn(peek());
    expect(note()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(1);
    act(() => view.surfaces.videoStatus('failed'));
    pressOut(peek());
    pressIn(peek());
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(lines(view, 'peek.retry')).toHaveLength(1);
  });

  it('R2 a player that shows a picture earns its schedule back: failures spread by a picture never give up', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    let cycles = 0;
    for (let cycle = 0; cycle <= PLAYER_RETRY_MS.length; cycle += 1) {
      // Always the FIRST wait: the schedule is whole again after each picture.
      expect(failAndWait(view, 0)).toEqual({ before: cycle + 1, after: cycle + 2 });
      act(() => view.surfaces.videoStatus('ready'));
      cycles += 1;
    }
    expect(cycles).toBe(PLAYER_RETRY_MS.length + 1);
    expect(video()).toBeTruthy();
    expect(note()).toBeNull();
    expect(lines(view, 'peek.retry').every((line) => line.fields.attempt === 0)).toBe(true);
  });

  it('R2b a picture does not remount the player that just showed it', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    expect(failAndWait(view, 0)).toEqual({ before: 1, after: 2 });
    act(() => view.surfaces.videoStatus('ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBeNull();
  });

  it('a player that was ready, then lost its window and got it back, starts from loading whatever the new one says', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(video()).toBeNull();
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    // The double reports nothing on mount: only the layer's own memory can say loading here.
    expect(note()).toBe(WAITING);
  });

  it('a retry that comes due while no player is mounted is not spent', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(500));
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    // The window coming back mounted a fresh player: that WAS the retry, so the first wait is still ahead.
    expect(failAndWait(view, 0)).toEqual({ before: 2, after: 3 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      { attempt: 0 },
      { attempt: 0 },
    ]);
  });

  it('M31 the next broadcast starts from waiting, not from the last one’s window', async () => {
    const view = await liveWithoutWindow();
    windowLands(view);
    act(() => view.engine.scene('stopped'));
    act(() => view.engine.scene('paired-ready'));
    goLiveWithoutWindow(view);
    pressIn(peek());
    expect(note()).toBe(WAITING);
    expect(video()).toBeNull();
  });

  it('M32 the record names states and numbers only: no url, no host, no manifest', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? 0));
    const peeked = readRecord(view.record).filter((line) => line.event.startsWith('peek.'));
    expect(peeked.map((line) => line.event)).toEqual([
      'peek.state',
      'peek.state',
      'peek.firstWindow',
      'peek.state',
      'peek.retry',
    ]);
    const allowedKeys = new Set(['state', 'delivery', 'ms', 'attempt', 'status']);
    for (const line of peeked)
      for (const key of Object.keys(line.fields)) expect(allowedKeys.has(key)).toBe(true);
    const text = view.record.lines().join('\n');
    for (const secret of ['video.example', 'm3u8', 'manifest', 'http'])
      expect(text).not.toContain(secret);
  });

  it('records each change of what it shows once, with the word that came with it, and not on every report', async () => {
    const view = await liveWithoutWindow();
    windowLands(view);
    for (let second = 0; second < 5; second += 1) act(() => vi.advanceTimersByTime(1_000));
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(lines(view, 'peek.state').map((line) => line.fields)).toEqual([
      { state: 'none', delivery: 'unknown' },
      { state: 'waiting', delivery: 'unknown' },
      { state: 'playing', delivery: 'ok' },
      { state: 'unavailable', delivery: 'stalled' },
    ]);
  });

  it('M26b a delivery word with no broadcast behind it is not a first window', async () => {
    const view = await renderViewfinder({}, { engine: 'idle' });
    act(() => view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }));
    // The set-up is what the test claims: native says ok, there is no manifest to play.
    expect(view.ports.engine.getSnapshot().telemetry.delivery).toBe('ok');
    expect(view.ports.engine.getSnapshot().broadcast).toBeNull();
    expect(lines(view, 'peek.firstWindow')).toHaveLength(0);
  });

  it('M26c a delivery word before the air is not a window, and the same word on air is', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('connecting'));
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    expect(view.ports.engine.getSnapshot().broadcast).not.toBeNull();
    expect(lines(view, 'peek.firstWindow')).toHaveLength(0);
    act(() => view.engine.scene('live'));
    expect(lines(view, 'peek.firstWindow')).toHaveLength(1);
  });

  it('M27d the stretch is the whole live run: publishing turning degraded does not start it again', async () => {
    const view = await liveWithoutWindow();
    advance(view, 30_000);
    act(() => {
      view.engine.forceState({
        kind: 'degraded',
        transport: 'srt',
        reason: 'poor-uplink',
        sinceEpochMs: 1,
      });
      view.engine.patch({ delivery: 'unknown', deliveredLagMs: null });
    });
    advance(view, 15_000);
    windowLands(view);
    expect(lines(view, 'peek.firstWindow').map((line) => line.fields)).toEqual([{ ms: 45_000 }]);
  });

  it('M30g a hold cancels a retry that is waiting, so the old wait cannot remount the next stretch’s player', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(500));
    act(() => view.engine.scene('holding'));
    goLiveWithoutWindow(view);
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(view.surfaces.videoMounts()).toBe(2);
    // And the new player's own first failure is retried: the old wait did not swallow it.
    expect(failAndWait(view, 0)).toEqual({ before: 2, after: 3 });
  });

  it('M30h leaves no timer behind when the viewfinder goes while a retry waits', async () => {
    const left = async (retryWaiting: boolean) => {
      const before = vi.getTimerCount();
      const view = await liveWithoutWindow();
      pressIn(peek());
      windowLands(view);
      if (retryWaiting) act(() => view.surfaces.videoStatus('failed'));
      view.unmount();
      return vi.getTimerCount() - before;
    };
    const without = await left(false);
    const withRetry = await left(true);
    // What is left is the fake engine's own heartbeat, counted so the sum is not vacuous.
    expect(without).toBeGreaterThanOrEqual(1);
    expect(withRetry).toBe(without);
  });

  it('M53 draws no line, not even for one render, in the render where the air has just gone and the peek is still letting go', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    const drawn: string[] = [];
    const watch = new MutationObserver(() => undefined);
    watch.observe(view.container, { childList: true, subtree: true });
    // Paired: nothing to show, but the stage still holds the broadcast's URL for the render in which the peek lets go.
    act(() => view.engine.forceState({ kind: 'paired' }));
    const NOTE = '[data-testid="viewer-note"]';
    for (const record of watch.takeRecords())
      for (const node of record.addedNodes)
        if (
          node instanceof HTMLElement &&
          (node.matches(NOTE) || node.querySelector(NOTE) !== null)
        )
          drawn.push(node.outerHTML);
    watch.disconnect();
    expect(drawn).toEqual([]);
    expect(view.ports.engine.getSnapshot().broadcast).not.toBeNull();
    expect(note()).toBeNull();
    expect(video()).toBeNull();
  });

  it('says it in every language, from the dictionary', async () => {
    const dictionaries = [
      ['en', en],
      ['es', es],
      ['fr', fr],
      ['nl', nl],
    ] as const;
    let rows = 0;
    for (const [language, dictionary] of dictionaries) {
      const view = await renderViewfinder({ deviceLanguages: [language] });
      goLiveWithoutWindow(view);
      pressIn(screen.getByRole('button', { name: dictionary['stream.peek.label'] }));
      expect({ language, note: note() }).toEqual({
        language,
        note: dictionary['stream.peek.loading'],
      });
      view.unmount();
      rows += 1;
    }
    expect(rows).toBe(4);
  });
});

/**
 * The seam, through the REAL producer and consumer: the real `createNativeSurfaces` Video (only the
 * expo-video package behind it is a double) talking to the real hook inside the real stage. A fake on
 * both ends would prove the fake.
 */
describe('the viewer layer through the real native Video', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function onNative() {
    const expo = fakeVideo();
    const native = createNativeSurfaces({
      logger: createLogger({ record: createRingRecord(), now: () => 0 }),
      packages: {
        webview: () => Promise.reject(new Error('not under test')),
        video: async () => expo.pkg,
        preview: async () => null,
      },
    });
    const view = await renderViewfinder({
      surfaces: { ...createFakeSurfaces(), Video: native.Video },
    });
    goLiveWithoutWindow(view);
    pressIn(peek());
    windowLands(view);
    // The package loads on first draw (m3).
    await act(() => vi.advanceTimersByTimeAsync(10));
    return { view, expo };
  }

  it('the player’s own status events drive the note, and a failure is replaced by a fresh player', async () => {
    const { expo } = await onNative();
    expect(expo.player.addListener).toHaveBeenCalledTimes(1);
    // The player reported its own word on mount: still loading.
    expect(note()).toBe(WAITING);
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
    expect(expo.player.play).toHaveBeenCalled();

    act(() => expo.emit('error'));
    expect(note()).toBe(WAITING);
    expect(expo.player.addListener).toHaveBeenCalledTimes(1);
    // A fresh player starts from loading; the double is one object, so say so.
    expo.player.status = 'loading';
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(expo.player.addListener).toHaveBeenCalledTimes(2);
    expect(expo.listeners).toHaveLength(1);
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
  });

  it('a player that errors for good is given up on, through the real listener', async () => {
    const { expo } = await onNative();
    let mounted = 1;
    for (const wait of PLAYER_RETRY_MS) {
      expo.player.status = 'loading';
      act(() => expo.emit('error'));
      act(() => vi.advanceTimersByTime(wait));
      mounted += 1;
      expect(expo.player.addListener).toHaveBeenCalledTimes(mounted);
    }
    expect(mounted).toBe(PLAYER_RETRY_MS.length + 1);
    act(() => expo.emit('error'));
    expect(note()).toBe(NONE);
    expect(expo.listeners).toHaveLength(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(expo.player.addListener).toHaveBeenCalledTimes(mounted);
  });
});
