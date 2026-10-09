import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { DeliveryWord } from '@/domain/session/viewerFeed';
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
import { renderViewfinder } from '../../test/renderViewfinder';

type View = Awaited<ReturnType<typeof renderViewfinder>>;

const peek = () => screen.getByRole('button', { name: en['stream.peek.label'] });
/** A tap on What viewers see: it opens the view, or closes an open one (D2 §4.3). */
const tap = () => fireEvent.click(peek());
/** The line in the middle of the cover: the loading countdown, no picture, or not ready. */
const note = () => screen.queryByTestId('viewer-note')?.textContent ?? null;
const video = () => screen.queryByTestId('viewer-video');
const cover = () => screen.queryByTestId('viewer-cover');
/**
 * The view's loading line (D2 §4.3). While the view loads, the cover shows this countdown whatever the feed says, so
 * what the layer decided is read from the record (`decided`), and the cover's own lines only once it is showing.
 */
const counting = (seconds: number, dictionary: Record<string, string> = en) =>
  (dictionary['stream.peek.loading'] ?? '').replace('{seconds}', String(seconds));
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

/**
 * A player that fails, waits its schedule, and is replaced: the number of mounts after each wait. Both clocks move, so
 * the view's own deadlines stay the spec's (ledger P7).
 */
function failAndWait(view: View, index: number) {
  const wait = PLAYER_RETRY_MS[index] ?? Number.NaN;
  act(() => view.surfaces.videoStatus('failed'));
  advance(view, wait - 1);
  const before = view.surfaces.videoMounts();
  advance(view, 1);
  return { before, after: view.surfaces.videoMounts() };
}

/** Live, a window, the view open, and every retry spent: the layer has given up on the player (2 s into loading). */
async function givenUp() {
  const view = await liveWithoutWindow();
  tap();
  windowLands(view);
  for (const index of PLAYER_RETRY_MS.keys()) failAndWait(view, index);
  act(() => view.surfaces.videoStatus('failed'));
  return view;
}

const lines = (view: View, event: string) =>
  readRecord(view.record).filter((line) => line.event === event);

/** What the layer last decided to show, as it wrote it to the record. */
const decided = (view: View) => lines(view, 'peek.state').at(-1)?.fields.state;

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
    tap();
    expect(decided(view)).toBe('waiting');
    expect(note()).toBe(counting(5));
    expect(video()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(0);
  });

  it('plays the moment the first window lands, loading until the player says ready, and records the time', async () => {
    const view = await liveWithoutWindow();
    // D2 §4.3: the view lasts 5 s while it loads, so the long wait is on air with it closed, and it opens near the end.
    advance(view, 19_000);
    tap();
    advance(view, 2_000);
    expect(video()).toBeNull();
    windowLands(view);
    expect(video()?.dataset.playing).toBe('true');
    expect(note()).toBe(counting(3));
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    const first = lines(view, 'peek.firstWindow');
    expect(first).toHaveLength(1);
    expect(first[0]?.fields).toEqual({ ms: 21_000 });
  });

  it('R3 opening the viewfinder on a broadcast already delivering records no first window: it did not see the start', async () => {
    const view = await renderViewfinder(
      {},
      { strict: true, prepare: (fakes) => fakes.engine.scene('live') },
    );
    // The set-up is what the test claims: on air, the window already there, and a player offered.
    expect(view.ports.engine.getSnapshot().telemetry.delivery).toBe('ok');
    tap();
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

  it('M27 has no patience of its own: two minutes on air with no window still say waiting, and a window plays (D2 §4.3)', async () => {
    const view = await liveWithoutWindow();
    // The view's own countdown is the patience now (D2 §4.3); the layer keeps none, so two minutes on air leave it
    // waiting. The minutes pass with the view closed: it lives 5 s while it loads.
    advance(view, 60_000);
    expect(decided(view)).toBe('waiting');
    advance(view, 60_000);
    expect(decided(view)).toBe('waiting');
    tap();
    expect(note()).toBe(counting(5));
    expect(video()).toBeNull();
    windowLands(view);
    expect(video()).toBeTruthy();
  });

  it('M28 one failed poll after the first window keeps playing', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
    expect(video()).toBeTruthy();
    expect(view.surfaces.videoMounts()).toBe(1);
  });

  it('M29 a hold unmounts the player, and the way back waits for a fresh window', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    // Showing, so the cover's lines are the layer's (D2 §4.3).
    act(() => view.surfaces.videoStatus('ready'));
    expect(view.surfaces.videoMounts()).toBe(1);
    act(() => view.engine.scene('holding'));
    expect(video()).toBeNull();
    expect(note()).toBe(NONE);
    goLiveWithoutWindow(view);
    expect(decided(view)).toBe('waiting');
    // Showing, with nothing to play: the cover says there is no picture rather than go blank.
    expect(note()).toBe(NONE);
    expect(video()).toBeNull();
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBeNull();
    // The stretch after a hold began on this screen, so its first window is recorded too.
    expect(lines(view, 'peek.firstWindow')).toHaveLength(2);
  });

  it('native’s stalled word is no picture, with no player, and the view then says it is not ready', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('not-delivered'));
    tap();
    expect(decided(view)).toBe('unavailable');
    expect(note()).toBe(counting(5));
    expect(video()).toBeNull();
    // No player, so no first frame: at 5 s the view says so, honestly (D2 §4.3).
    act(() => vi.advanceTimersByTime(5_000));
    expect(note()).toBe(en['stream.peek.notReady']);
    expect(view.surfaces.videoMounts()).toBe(0);
  });

  it('a window that stalls and comes back plays again from a fresh player', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(decided(view)).toBe('unavailable');
    expect(video()).toBeNull();
    windowLands(view);
    expect(decided(view)).toBe('playing');
    expect(view.surfaces.videoMounts()).toBe(2);
    // Still loading: the countdown, whatever the feed did meanwhile.
    expect(note()).toBe(counting(5));
  });

  it('retries a failed player once, quietly, after 2 s, and gives up on the second failure (D2 §4.3)', async () => {
    expect(PLAYER_RETRY_MS).toEqual([2_000]);
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(1);
    // 1st failure: no remount before 2 s, one at 2 s, and the operator reads the view's countdown meanwhile.
    act(() => view.surfaces.videoStatus('failed'));
    expect(note()).toBe(counting(5));
    act(() => vi.advanceTimersByTime(1_999));
    expect(view.surfaces.videoMounts()).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(view.surfaces.videoMounts()).toBe(2);
    // 2nd failure: given up, no player, and no remount at any later time.
    act(() => view.surfaces.videoStatus('failed'));
    expect(decided(view)).toBe('unavailable');
    expect(video()).toBeNull();
    expect(note()).toBe(counting(3));
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.surfaces.videoMounts()).toBe(2);
    // The record says it retried once, and which retry that was.
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([{ attempt: 0 }]);
  });

  it('M30c once given up it stays given up: no new player while the view lives, and a minute after it closed still unavailable', async () => {
    const view = await givenUp();
    const mounts = view.surfaces.videoMounts();
    expect(mounts).toBe(PLAYER_RETRY_MS.length + 1);
    expect(decided(view)).toBe('unavailable');
    // The rest of the view (to 5 s loading, then 3 s not ready): no new player.
    for (let second = 0; second < 5; second += 1) advance(view, 1_000);
    expect(cover()).not.toBeNull();
    advance(view, 1_000);
    expect(cover()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(mounts);
    // Closing the view is not a reason to try again (only opening it is, R1).
    for (let second = 0; second < 60; second += 1) act(() => vi.advanceTimersByTime(1_000));
    expect(decided(view)).toBe('unavailable');
    expect(video()).toBeNull();
    expect(view.surfaces.videoMounts()).toBe(mounts);
    expect(lines(view, 'peek.retry')).toHaveLength(PLAYER_RETRY_MS.length);
  });

  it('M30d two failed reports from one player are one failure, not two', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    const wait = PLAYER_RETRY_MS[0] ?? Number.NaN;
    act(() => view.surfaces.videoStatus('failed'));
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(wait));
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(video()).not.toBeNull();
    // One retry was spent, not two: the replacement's own failure is the give-up.
    act(() => view.surfaces.videoStatus('failed'));
    expect(decided(view)).toBe('unavailable');
    expect(video()).toBeNull();
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([{ attempt: 0 }]);
  });

  it('M30e a player that fails mid-view is retried quietly: no line, the view stays, a fresh player at 2 s (D2 §4.3)', async () => {
    // This replaces M30e's and M54b's "waiting again while the replacement loads": the cover draws no line over a
    // playing feed, so the line those two read is gone.
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    act(() => view.surfaces.videoStatus('failed'));
    expect(note()).toBeNull();
    expect(cover()).not.toBeNull();
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBeNull();
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    expect(video()).not.toBeNull();
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
      // The view is closed first: opening it again would itself try again (R1), so it must not be what forgets.
      tap();
      expect({ name, cover: cover() }).toEqual({ name, cover: null });
      act(() => view.engine.forceState(state));
      // The way back, in one act (a forced state brings its own `ok`): native has seen no window yet.
      act(() => {
        view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
        view.engine.patch({ delivery: 'unknown', deliveredLagMs: null });
      });
      // What the layer decided, read from the record, before the view opens again.
      expect({ name, decided: decided(view) }).toEqual({ name, decided: 'waiting' });
      windowLands(view);
      expect({ name, decided: decided(view) }).toEqual({ name, decided: 'playing' });
      tap();
      expect({ name, mounts: view.surfaces.videoMounts(), note: note() }).toEqual({
        name,
        mounts: mounts + 1,
        note: counting(5),
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

  it('M54 a rebuffer after the first picture keeps the picture: ready, loading, ready never shows a line or drops the player', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    // Before the first picture the view is loading, and says so with its countdown.
    act(() => view.surfaces.videoStatus('loading'));
    expect(note()).toBe(counting(5));
    const seen: (string | null)[] = [];
    for (const status of ['ready', 'loading', 'loading', 'ready'] as const) {
      act(() => view.surfaces.videoStatus(status));
      seen.push(note());
      expect(video()).toBeTruthy();
    }
    expect(seen).toEqual([null, null, null, null]);
    expect(view.surfaces.videoMounts()).toBe(1);
  });

  it('M55 a second view, after the first showed a picture, is a fresh one: its countdown and a new player (no warm, D2 §4.3)', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    tap();
    // Closed: the player is gone at once, with the status it left.
    expect(video()).toBeNull();
    tap();
    expect(view.surfaces.videoMounts()).toBe(2);
    // The fresh player has shown nothing yet, and the new view has not seen a frame: it loads.
    expect(note()).toBe(counting(5));
  });

  it('M55b a retry that comes due after the view closed is not spent on a player nobody can see', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    // The player fails; its retry would be due 2 s later. The view closes 1 s in.
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(1_000));
    tap();
    expect(cover()).toBeNull();
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(video()).toBeNull();
    const mounts = view.surfaces.videoMounts();
    expect(mounts).toBe(1);
    tap();
    expect(view.surfaces.videoMounts()).toBe(mounts + 1);
    // The new player's first failure waits the FIRST rung.
    expect(failAndWait(view, 0)).toEqual({ before: mounts + 1, after: mounts + 2 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      { attempt: 0 },
      { attempt: 0 },
    ]);
  });

  it('M55d a retry that falls due on the not-ready line is not spent: the next view still retries at 2 s (B3 review I1)', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    // The player fails 3.5 s into loading. Its retry would fall due at 5.5 s, on the not-ready line, which draws no
    // player: nobody could see what that retry mounts.
    advance(view, 3_500);
    act(() => view.surfaces.videoStatus('failed'));
    advance(view, 1_500);
    expect(note()).toBe(en['stream.peek.notReady']);
    expect(video()).toBeNull();
    advance(view, 500);
    advance(view, 2_500);
    expect(cover()).toBeNull();
    const mounts = view.surfaces.videoMounts();
    expect(mounts).toBe(1);
    // The operator tries again, as the line asks: a fresh player, and its first failure waits the first rung.
    tap();
    expect(view.surfaces.videoMounts()).toBe(mounts + 1);
    expect(failAndWait(view, 0)).toEqual({ before: mounts + 1, after: mounts + 2 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      { attempt: 0 },
      { attempt: 0 },
    ]);
  });

  it('R1 opening the view after the give-up tries again with a fresh player, from the first wait', async () => {
    const view = await givenUp();
    const mounts = view.surfaces.videoMounts();
    expect(decided(view)).toBe('unavailable');
    tap();
    tap();
    expect(view.surfaces.videoMounts()).toBe(mounts + 1);
    expect(decided(view)).toBe('playing');
    expect(note()).toBe(counting(5));
    expect(failAndWait(view, 0)).toEqual({ before: mounts + 1, after: mounts + 2 });
    expect(lines(view, 'peek.retry').map((line) => line.fields)).toEqual([
      ...[...PLAYER_RETRY_MS.keys()].map((attempt) => ({ attempt })),
      { attempt: 0 },
    ]);
  });

  it('R1b opening the view before a give-up gives nothing back: a spent retry stays spent until a picture or a give-up', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    // The retry is spent and its replacement has shown nothing yet.
    expect(failAndWait(view, 0)).toEqual({ before: 1, after: 2 });
    tap();
    tap();
    // No warm (D2 §4.3): the reopened view mounts its own player, and the schedule is where it was.
    expect(view.surfaces.videoMounts()).toBe(3);
    expect(lines(view, 'peek.retry')).toHaveLength(1);
    act(() => view.surfaces.videoStatus('failed'));
    expect(decided(view)).toBe('unavailable');
    expect(lines(view, 'peek.retry')).toHaveLength(1);
  });

  it('R2 a player that shows a picture earns its schedule back: failures spread by a picture never give up', async () => {
    const view = await liveWithoutWindow();
    tap();
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
    tap();
    windowLands(view);
    expect(failAndWait(view, 0)).toEqual({ before: 1, after: 2 });
    act(() => view.surfaces.videoStatus('ready'));
    // The whole showing, short of its last millisecond (D2 §4.3: 20 s from the first frame).
    advance(view, 19_999);
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(video()).not.toBeNull();
    expect(note()).toBeNull();
  });

  it('mid-view, a window that stalls says there is no picture, and its return mounts a fresh player and clears the line', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    act(() => view.engine.patch({ delivery: 'stalled', deliveredLagMs: 21_000 }));
    expect(video()).toBeNull();
    expect(note()).toBe(NONE);
    windowLands(view);
    expect(view.surfaces.videoMounts()).toBe(2);
    expect(note()).toBeNull();
  });

  it('a retry that comes due while no player is mounted is not spent', async () => {
    const view = await liveWithoutWindow();
    tap();
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
    tap();
    expect(decided(view)).toBe('waiting');
    expect(note()).toBe(counting(5));
    expect(video()).toBeNull();
  });

  it('M32 the record names states and numbers only: no url, no host, no manifest', async () => {
    const view = await liveWithoutWindow();
    tap();
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
    tap();
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
      tap();
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

  it('M53 draws no line, not even for one render, in the render where the air has just gone and the view is still closing', async () => {
    const view = await liveWithoutWindow();
    tap();
    windowLands(view);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    const drawn: string[] = [];
    const watch = new MutationObserver(() => undefined);
    watch.observe(view.container, { childList: true, subtree: true });
    // Paired: nothing to show, but the stage still holds the broadcast's URL for the render in which the view closes.
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
      fireEvent.click(screen.getByRole('button', { name: dictionary['stream.peek.label'] }));
      expect({ language, note: note() }).toEqual({ language, note: counting(5, dictionary) });
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
        video: async () => expo.pkg,
        preview: async () => null,
      },
    });
    const view = await renderViewfinder({
      surfaces: { ...createFakeSurfaces(), Video: native.Video },
    });
    goLiveWithoutWindow(view);
    tap();
    windowLands(view);
    // The package loads on first draw (m3).
    await act(() => vi.advanceTimersByTimeAsync(10));
    return { view, expo };
  }

  it('the player’s own status events drive the view, and a failure is replaced by a fresh player, quietly', async () => {
    const { expo } = await onNative();
    expect(expo.player.addListener).toHaveBeenCalledTimes(1);
    // The player reported its own word on mount: still loading.
    expect(note()).toBe(counting(5));
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
    expect(expo.player.play).toHaveBeenCalled();

    act(() => expo.emit('error'));
    // One quiet retry (D2 §4.3): no line over the view while it waits.
    expect(note()).toBeNull();
    expect(cover()).not.toBeNull();
    expect(expo.player.addListener).toHaveBeenCalledTimes(1);
    // A fresh player starts from loading; the double is one object, so say so.
    expo.player.status = 'loading';
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? Number.NaN));
    expect(expo.player.addListener).toHaveBeenCalledTimes(2);
    expect(expo.listeners).toHaveLength(1);
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
  });

  it('M55c a second view through the real Video is a fresh one: the player was released on close, and a new one loads', async () => {
    const { expo } = await onNative();
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
    tap();
    // No warm (D2 §4.3): closing releases the player at once.
    expect(screen.queryByTestId('video-view')).toBeNull();
    expect(expo.listeners).toHaveLength(0);
    // A fresh ExoPlayer starts loading; the double is one object, so say so.
    expo.player.status = 'loading';
    tap();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.queryByTestId('video-view')).not.toBeNull();
    expect(note()).toBe(counting(5));
    act(() => expo.emit('readyToPlay'));
    expect(note()).toBeNull();
  });

  it('a player that errors for good is given up on, through the real listener', async () => {
    const { view, expo } = await onNative();
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
    expect(lines(view, 'peek.state').at(-1)?.fields.state).toBe('unavailable');
    expect(screen.queryByTestId('video-view')).toBeNull();
    expect(expo.listeners).toHaveLength(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(expo.player.addListener).toHaveBeenCalledTimes(mounted);
  });
});
