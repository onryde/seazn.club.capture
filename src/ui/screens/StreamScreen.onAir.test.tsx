import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { HOLD_MS } from '@/hooks/useHold';
import type { FakePorts } from '../../../test/fakePorts';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const plate = () => screen.getByTestId('tally-plate').textContent;
const stop = () => screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' });
const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const peek = () => screen.getByRole('button', { name: 'What viewers see' });
const fill = () => screen.getByTestId('hold-fill').dataset.holding;
const sent = (view: Awaited<ReturnType<typeof renderViewfinder>>, kind: 'start' | 'stop') =>
  view.engine.intents.filter((intent) => intent.kind === kind);

/** Copy from en.json: the tests read the dictionary, not the code under test. */
const LIVE_LINE = 'Live. Sound and picture going out.';
const SHED = 'Preview paused — still live';
const OVERLAY_FAILED = 'Score preview failed — the broadcast is not affected';
const NOT_CHARGING = 'Not charging — plug in for a long match';
const SCORE_AHEAD = 'You see the score slightly ahead of viewers';
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
    await onAir('connecting');
    expect(plate()).toBe('Connecting');
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Opening the link.')).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  it('says live with no sound when the level drops under the floor on air (D39)', async () => {
    const view = await onAir('live');
    act(() => view.engine.patch({ audioLevel: 0.01 }));
    expect(plate()).toBe('Live');
    expect(screen.getByText('Live with no sound. Check the mic now.')).toBeTruthy();
  });

  it('shows live: the plate, the clock, the line, and Stop in place of Go live', async () => {
    await onAir('live');
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
    const view = await onAir('live');
    act(() => void view.back.press());
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('never hides a fault: the no-sound line outranks it at once (ruling I2)', async () => {
    const view = await onAir('live');
    act(() => void view.back.press());
    act(() => view.engine.patch({ audioLevel: 0 }));
    expect(screen.getByText('Live with no sound. Check the mic now.')).toBeTruthy();
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
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

  it('never lets a failing heartbeat change what the operator sees (ruling 5)', async () => {
    const view = await onAir('live');
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

  it('after another app lets go: Trouble, the reopening line, then Live at the first frame', async () => {
    await onAir('camera-reopened');
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(REOPENING)).toBeTruthy();
    expect(screen.queryByText(/slate/)).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(plate()).toBe('Live');
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('through the operator’s switch: still Live, the reopening line, then the live line', async () => {
    await onAir('camera-switching');
    expect(plate()).toBe('Live');
    expect(screen.getByText(REOPENING)).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
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

describe('what viewers see (spec §4, carry 13)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays what viewers see the moment the finger lands, at the capped rendition', async () => {
    await onAir('live');
    pressIn(peek());
    const video = screen.getByTestId('viewer-video');
    expect(video.dataset.playing).toBe('true');
    expect(video.dataset.url).toBe(
      'https://video.example/fake/manifest/video.m3u8?clientBandwidthHint=1.0',
    );
  });

  it('offers no peek before the broadcast starts', async () => {
    await renderViewfinder();
    expect(screen.queryByRole('button', { name: 'What viewers see' })).toBeNull();
  });

  /**
   * A descriptor always carries a playback URL (parseDescriptor refuses one
   * without), so no picture means no descriptor: native on air in a session
   * it reports none for, as the unarmed fake does.
   */
  const liveWithNoDescriptor = { prepare: (fakes: FakePorts) => fakes.engine.scene('live') };

  it('is off, and says why, on air with no viewer picture: a press lights nothing', async () => {
    await renderViewfinder({}, liveWithNoDescriptor);
    expect(plate()).toBe('Live');
    expect(peek().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No viewer picture')).toBeTruthy();
    pressIn(peek());
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });

  it('gives no reason while the picture is there', async () => {
    await onAir('live');
    expect(peek().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('No viewer picture')).toBeNull();
  });

  it('says why in French', async () => {
    await renderViewfinder({ deviceLanguages: ['fr'] }, liveWithNoDescriptor);
    expect(screen.getByText('Image indisponible')).toBeTruthy();
  });

  it('lets go of the picture when the broadcast ends under the finger', async () => {
    const view = await onAir('live');
    pressIn(peek());
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });
});

/** The score preview on air: shed first (AGENTS §8), a failure a caption (AGENTS §7). */
describe('the score preview on air', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sheds the overlay on a hot phone and says so, still Live (AGENTS §8, carry 12)', async () => {
    await onAir('shed');
    expect(plate()).toBe('Live');
    expect(screen.getByText(SHED)).toBeTruthy();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  });

  it('says it shed even with the score preview turned off (carry 13)', async () => {
    const view = await onAir('live');
    await act(() => view.ports.streamSettings.set({ overlay: false }));
    act(() => view.engine.scene('shed'));
    expect(screen.getByText(SHED)).toBeTruthy();
  });

  it('keeps the HUD whole when the overlay crashes, with a caption, not a plate', async () => {
    await renderViewfinder({}, { prepare: (fakes) => fakes.surfaces.crashOverlay() });
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    expect(screen.getByTestId('tally-plate')).toBeTruthy();
    expect(screen.queryByText('Something broke')).toBeNull();
  });

  it('says so when the overlay page fails to load', async () => {
    const view = await onAir('live');
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('tries again, with no caption, once the preview is hidden and shown (carry 13)', async () => {
    const view = await onAir('live');
    act(() => view.surfaces.failOverlay());
    await act(() => view.ports.streamSettings.set({ overlay: false }));
    await act(() => view.ports.streamSettings.set({ overlay: true }));
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.getByTestId('overlay')).toBeTruthy();
  });

  // M1: native re-fetches the descriptor on every reconnect (spec §1); a new
  // overlay URL is a new showing, tried afresh, with no caption.
  it('tries a new overlay URL afresh, with no caption (carry 13)', async () => {
    const view = await onAir('live');
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    const descriptor = view.engine.getSnapshot().descriptor;
    if (descriptor === null) throw new Error('armed with no descriptor');
    const next = 'https://stg.seazn.club/overlay/fixtures/next-fixture';
    act(() => view.engine.setDescriptor({ ...descriptor, overlayUrl: next }));
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.getByTestId('overlay').dataset.url).toBe(`${next}?delay=0`);
  });

  it('tries again once the phone cools, with no caption (carry 13)', async () => {
    const view = await onAir('live');
    act(() => view.surfaces.failOverlay());
    act(() => view.engine.scene('shed'));
    act(() => view.engine.scene('live'));
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.getByTestId('overlay')).toBeTruthy();
  });
});

/** Carry 14 (ruling M6): one caption, shed > overlay failed > not charging > score ahead. */
describe('the top strip’s one caption', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('puts not charging above the score-ahead note while arming', async () => {
    const view = await renderViewfinder();
    expect(screen.getByText(NOT_CHARGING)).toBeTruthy();
    expect(screen.queryByText(SCORE_AHEAD)).toBeNull();
    act(() => view.engine.patch({ charging: true }));
    expect(screen.getByText(SCORE_AHEAD)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });

  it('puts a failed preview above not charging', async () => {
    const view = await onAir('live');
    expect(screen.getByText(NOT_CHARGING)).toBeTruthy();
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });

  it('puts shed above not charging', async () => {
    await onAir('shed');
    expect(screen.getByText(SHED)).toBeTruthy();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });

  it('shows no score-ahead note on air', async () => {
    const view = await onAir('live');
    act(() => view.engine.patch({ charging: true }));
    expect(screen.queryByText(SCORE_AHEAD)).toBeNull();
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });
});
