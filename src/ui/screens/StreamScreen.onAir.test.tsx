import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { HOLD_MS } from '@/hooks/useHold';
import en from '@/i18n/en.json';
import type { FakePorts } from '../../../test/fakePorts';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const plate = () => screen.getByTestId('tally-plate').textContent;
const stop = () => screen.getByRole('button', { name: 'Hold to stop and unpair' });
/** Stop before the first frame ends the broadcast, not the pairing (owner decision 1, 2026-10-05). */
const stopNeverLive = () => screen.getByRole('button', { name: 'Hold to stop' });
const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const peek = () => screen.getByRole('button', { name: 'What viewers see' });
const fill = () => screen.getByTestId('hold-fill').dataset.holding;
const sent = (view: Awaited<ReturnType<typeof renderViewfinder>>, kind: 'start' | 'stop') =>
  view.engine.intents.filter((intent) => intent.kind === kind);

/** Copy from en.json: the tests read the dictionary, not the code under test. */
const LIVE_LINE = 'Live. Sound and picture going out.';
/** The heat caption on air with What viewers see hidden, as shipped (owner's ruling, 2026-10-09). */
const HOT_LIVE = 'Phone hot · still live';
const NOT_CHARGING = 'Not charging — plug in for a long match';
const REOPENING = 'Camera reopening — picture back shortly';

async function onAir(
  scene: FakeScene,
  options: Parameters<typeof renderViewfinder>[0] = {},
  setup: Parameters<typeof renderViewfinder>[1] = {},
) {
  const view = await renderViewfinder(options, setup);
  act(() => view.engine.scene(scene));
  return view;
}

describe('on air (spec §6, through the fake)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never reads LIVE while connecting', async () => {
    await onAir('connecting', {}, { quiet: true });
    expect(plate()).toBe('Connecting');
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Opening the link.')).toBeTruthy();
    expect(stopNeverLive()).toBeTruthy();
  });

  /**
   * Owner decision 1 (2026-10-05): a Stop unpairs only once the broadcast went live. Native says which states went
   * live: those it reports with `sinceEpochMs` (SessionState). Every state that offers Stop is swept, and each label
   * is read off the state's own shape, not a list of ours.
   */
  it('says Stop unpairs in every state that went live, and only those', async () => {
    const view = await renderViewfinder();
    const offeringStop: readonly SessionState[] = [
      { kind: 'arming', cause: 'operator', retrying: false },
      { kind: 'armed', cause: 'organiser', notReady: 'camera' },
      { kind: 'connecting', transport: 'srt' },
      { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 },
      { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 },
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 60,
        sinceEpochMs: 1,
      },
    ];
    const said: string[] = [];
    for (const state of offeringStop) {
      act(() => view.engine.forceState(state));
      const name = 'sinceEpochMs' in state ? 'Hold to stop and unpair' : 'Hold to stop';
      if (screen.queryByRole('button', { name }) !== null) said.push(state.kind);
    }
    expect(said).toEqual(offeringStop.map((state) => state.kind));
    expect(
      said.filter((kind) => ['publishing', 'degraded', 'reconnecting'].includes(kind)),
    ).toHaveLength(3);
  });

  it('says plain Live when the room is quiet on air (spec §4: a silent room is ready)', async () => {
    const view = await onAir('live', {}, { quiet: true });
    act(() => view.engine.patch({ audioLevel: 0.01 }));
    expect(plate()).toBe('Live');
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('shows live: the plate, the clock, the line, and Stop in place of Go live', async () => {
    await onAir('live', {}, { quiet: true });
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
    expect(stop()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Go live/ })).toBeNull();
    expect(screen.queryByLabelText(/^Camera:/)).toBeNull();
  });

  it('hides Home on air, and Back says how to stop instead of leaving', async () => {
    const view = await onAir('live');
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    act(() => void view.back.press());
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    expect(view.navigation.current()).toBe('stream');
  });

  it('says it for about 4 s, then the live line is back (ruling I2)', async () => {
    const view = await onAir('live', {}, { quiet: true });
    act(() => void view.back.press());
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('never hides a fault: a call arriving clears Back’s line at once (ruling I2, spec §4)', async () => {
    const view = await onAir('live');
    act(() => void view.back.press());
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    act(() => view.engine.scene('mic-silenced'));
    expect(screen.getByText(en['stream.status.micSilenced'])).toBeTruthy();
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
  });

  /** Back while the call holds the mic: the fault outranks Back's line, which only stands in for a calm one. */
  it('never hides a fault: Back during the mic-silenced warning keeps the warning (ruling I2, spec §4)', async () => {
    const view = await onAir('mic-silenced');
    expect(screen.getByText(en['stream.status.micSilenced'])).toBeTruthy();
    act(() => void view.back.press());
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText(en['stream.status.micSilenced'])).toBeTruthy();
    expect(screen.queryByText(en['stream.leaveOnAir'])).toBeNull();
    expect(view.navigation.current()).toBe('stream');
  });

  it('stops once after a full 3 s hold on Stop', async () => {
    const view = await onAir('live');
    pressIn(stop());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(sent(view, 'stop')).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(sent(view, 'stop')).toHaveLength(1);
    // Ended: the hold control is gone.
    expect(screen.queryByRole('button', { name: /^Stop\./ })).toBeNull();
  });

  it.each<[FakeScene, string]>([
    ['fell-back', 'Switched to backup link (RTMPS)'],
    ['holding', 'Uplink lost — holding, 38 s of 183'],
    ['stalled', 'Video stalled — restarting, 38 s of 183'],
    ['restarting', 'Viewers not receiving — restarting, 38 s of 183'],
    ['not-delivered', 'Viewers not receiving — restarting'],
    ['camera-taken', 'Camera taken by another app — slate on air'],
    ['mic-silenced', 'Mic silenced by a call'],
  ])('%s reads Trouble, keeps the clock and Stop, and says: %s', async (scene, line) => {
    await onAir(scene);
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  /**
   * N29: a rejoin after the hold ran out is Reconnecting with cause hold-expired and no hold (0 of 0). The strip says
   * the urgent rejoin line with no countdown, the clock carries on from the first live time, and Stop unpairs (P3).
   */
  it('rejoining after the hold ran out: Trouble, the rejoin line with no countdown, the clock on, Stop unpairs', async () => {
    await onAir('rejoining');
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(en['stream.status.rejoinRetrying'])).toBeTruthy();
    expect(screen.queryByText(/\d+ s of \d+/)).toBeNull();
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  it('never lets a failing heartbeat change what the operator sees (ruling 5)', async () => {
    const view = await onAir('live', {}, { quiet: true });
    const heartbeat = {
      lastSentAtEpochMs: 0,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    act(() => view.engine.patch({ heartbeat }));
    expect(plate()).toBe('Live');
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
    expect(screen.queryByText(/Phone is hot|failed/)).toBeNull();
  });

  it('reads holding in Spanish, within the column', async () => {
    await onAir('holding', { deviceLanguages: ['es'] });
    expect(plate()).toBe('Problema');
    expect(screen.getByText('Sin conexión: esperando, 38 s de 183')).toBeTruthy();
  });
});

/** The camera ruling at the screen: our own reopen or switch on air makes no slate claim. */
describe('our own camera coming back (camera ruling)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The fake phone as it is (unplugged, so Not charging is active): the reopening line is URGENT (an interruption), so
  // it keeps the strip's one message from the caption. Then it is the live line's turn, which is routine, so the phone is
  // plugged in to read it and not the caption (the gate on the reopening line is what the first half of each proves).
  it('after another app lets go: Trouble, the reopening line, then Live at the first frame', async () => {
    const view = await onAir('camera-reopened');
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(REOPENING)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
    expect(screen.queryByText(/slate/)).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(plate()).toBe('Live');
    expect(screen.getByTestId('strip-message').textContent).toBe(NOT_CHARGING);
    act(() => view.engine.patch({ charging: true }));
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('through the operator’s switch: still Live, the reopening line, then the live line', async () => {
    const view = await onAir('camera-switching');
    expect(plate()).toBe('Live');
    expect(screen.getByText(REOPENING)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    act(() => view.engine.patch({ charging: true }));
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('says it in Dutch', async () => {
    await onAir('camera-switching', { deviceLanguages: ['nl'] });
    expect(screen.getByText('Camera gaat weer open: beeld zo terug')).toBeTruthy();
  });
});

/**
 * Carry 13: the hold belongs to the action the finger landed on. Go live
 * turning into Stop under a held finger abandons the hold; a state change
 * that keeps Stop keeps it.
 */
describe('the hold under a moving state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never carries a Go live hold over to Stop', async () => {
    const view = await renderViewfinder();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(1000));
    act(() => view.engine.scene('live'));
    expect(fill()).toBe('false');
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect([sent(view, 'start'), sent(view, 'stop')]).toEqual([[], []]);
  });

  it('keeps a Stop hold through a change of trouble on air', async () => {
    const view = await onAir('live');
    pressIn(stop());
    act(() => vi.advanceTimersByTime(1000));
    act(() => view.engine.scene('fell-back'));
    expect(fill()).toBe('true');
    act(() => vi.advanceTimersByTime(HOLD_MS - 1000));
    expect(sent(view, 'stop')).toHaveLength(1);
  });
});

/**
 * What viewers see built in: it is hidden as shipped (the owner's ruling, 2026-10-09; StreamScreen.viewerHidden.test.tsx),
 * and these keep the hidden code tested.
 */
describe('what viewers see (spec §4, carry 13), built in', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const BUILT_IN = { viewerCheck: true } as const;

  it('plays what viewers see on a tap, at the capped rendition', async () => {
    await onAir('live', {}, BUILT_IN);
    fireEvent.click(peek());
    const video = screen.getByTestId('viewer-video');
    expect(video.dataset.playing).toBe('true');
    expect(video.dataset.url).toBe(
      'https://video.example/fake/manifest/video.m3u8?clientBandwidthHint=1.0',
    );
  });

  it('offers no peek before the broadcast starts', async () => {
    await renderViewfinder({}, BUILT_IN);
    expect(screen.queryByRole('button', { name: 'What viewers see' })).toBeNull();
  });

  /**
   * A broadcast always carries a playback URL (BroadcastInfo.playbackUrl is
   * required), so no picture means no broadcast in the snapshot: native on air
   * with none reported, forced here on an engine that holds no pairing.
   */
  const liveWithNoBroadcast = {
    ...BUILT_IN,
    engine: 'idle',
    prepare: (fakes: FakePorts) =>
      fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }),
  } as const;

  it('is off, and says why, on air with no viewer picture: a press lights nothing', async () => {
    await renderViewfinder({}, liveWithNoBroadcast);
    expect(plate()).toBe('Live');
    expect(peek().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No viewer picture')).toBeTruthy();
    fireEvent.click(peek());
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    expect(screen.queryByTestId('viewer-cover')).toBeNull();
  });

  it('gives no reason while the picture is there', async () => {
    await onAir('live', {}, BUILT_IN);
    expect(peek().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('No viewer picture')).toBeNull();
  });

  it('says why in French', async () => {
    await renderViewfinder({ deviceLanguages: ['fr'] }, liveWithNoBroadcast);
    expect(screen.getByText('Image indisponible')).toBeTruthy();
  });

  it('lets go of the picture when the broadcast ends mid-view', async () => {
    const view = await onAir('live', {}, BUILT_IN);
    fireEvent.click(peek());
    expect(screen.queryByTestId('viewer-video')).not.toBeNull();
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });
});

/** A hot phone on air: a device condition, a caption, never a degraded broadcast (AGENTS §8). */
describe('a hot phone on air', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says so on a hot phone, still Live (AGENTS §8, carry 12)', async () => {
    const view = await onAir('shed', {}, { quiet: true });
    expect(plate()).toBe('Live');
    expect(screen.getByText(HOT_LIVE)).toBeTruthy();
    // The strip says ONE message (owner, 2026-10-08): the caption is up, so the live line is not. The plate above still
    // says Live. The positive pair: when the phone cools the caption goes and the live line is back.
    expect(screen.queryByText(LIVE_LINE)).toBeNull();
    act(() => view.engine.scene('live'));
    expect(screen.queryByText(HOT_LIVE)).toBeNull();
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });
});

/** Carry 14 (ruling M6): one caption, heat > not charging; the score preview's two went with it (D2 §4.1). */
// The fake phone as it is: uncharged, which is the condition under test.
describe('the status strip’s one caption', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('puts heat above not charging', async () => {
    await onAir('shed');
    expect(screen.getByText(HOT_LIVE)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });

  // Owner ruling, 2026-10-08 (two tiers): a caption beats only a ROUTINE status line. A line that reports a failure or
  // needs action is URGENT and keeps the one line, on this phone, which is unplugged (Not charging is up on the live line).
  it.each<[FakeScene, string]>([
    ['fell-back', en['stream.status.fellBack']],
    ['mic-silenced', en['stream.status.micSilenced']],
    ['camera-taken', en['stream.status.cameraTaken']],
    ['not-delivered', en['stream.status.notDelivered']],
  ])('keeps the %s line over Not charging: an urgent line beats a caption', async (scene, line) => {
    const view = await onAir('live');
    expect(screen.getByTestId('strip-message').textContent).toBe(NOT_CHARGING);
    act(() => view.engine.scene(scene));
    expect(screen.getByTestId('strip-message').textContent).toBe(line);
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
    // And back: the line is routine again, so the caption that never went away takes the line.
    act(() => view.engine.scene('live'));
    expect(screen.getByTestId('strip-message').textContent).toBe(NOT_CHARGING);
  });
});
