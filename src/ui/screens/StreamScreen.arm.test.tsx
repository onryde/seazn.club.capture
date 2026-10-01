import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_NOW, FIXTURE_SECRETS } from '../../../test/fixtures/wire';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const plate = () => screen.getByTestId('tally-plate').textContent;
const arms = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  view.engine.intents.filter((intent) => intent.kind === 'arm');
const events = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  readRecord(view.record).map((entry) => entry.event);

const OVERLAY_FAILED = 'Score preview failed — the broadcast is not affected';
const UNUSABLE = "This code can't be used. Go Home and scan again.";
/** The other environment's host: a staging build trusts stg.seazn.club only (ruling 6). */
const PRODUCTION = 'https://seazn.club';

describe('the viewfinder arming (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms once with the saved code, and shows Arm ready', async () => {
    const view = await renderViewfinder();
    expect(arms(view)).toHaveLength(1);
    expect(plate()).toBe('Ready');
    expect(screen.getByText('Ready. Hold Go live for 3 seconds.')).toBeTruthy();
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Sound: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    // 13:10Z is 14:10 in London in October.
    expect(screen.getByText('Go live by 14:10')).toBeTruthy();
    expect(screen.getByText('Seazn XI v Fake CC')).toBeTruthy();
  });

  it('sends the heartbeat target with the arm, never logging its token', async () => {
    const view = await renderViewfinder();
    const [arm] = arms(view);
    expect(arm?.kind === 'arm' && arm.heartbeat.url).toBe(
      'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    );
    const logged = view.record.lines().join('\n');
    expect(logged).toContain('intent.arm');
    expect(arm?.kind === 'arm' && logged.includes(arm.heartbeat.token)).toBe(false);
  });

  it('records the arm with its slot, and nothing secret from the code (M14)', async () => {
    const view = await renderViewfinder();
    const armed = readRecord(view.record).filter((entry) => entry.event === 'intent.arm');
    expect(armed.map((entry) => entry.fields)).toEqual([{ slot: 1 }]);
    const logged = view.record.lines().join('\n');
    for (const secret of FIXTURE_SECRETS) expect(logged).not.toContain(secret);
  });

  it('starts once after a full 3 s hold on Go live', async () => {
    const view = await renderViewfinder();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.filter((intent) => intent.kind === 'start')).toHaveLength(1);
    // Connecting now: Stop has taken Go live's place.
    expect(
      screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' }),
    ).toBeTruthy();
  });

  it.each([
    ['cameraReady', { cameraReady: false }, 'Camera', 'Camera not ready', 'Camera not ready yet.'],
    [
      'networkReachable',
      { networkReachable: false },
      'Network',
      'No network',
      'No network. Check the signal.',
    ],
    [
      'audioLevel',
      { audioLevel: 0.01 },
      'Sound',
      'No sound',
      'No sound. Check the mic before going live.',
    ],
  ] as const)(
    'blocks Go live when %s is off, and says why',
    async (_, patch, chip, reason, line) => {
      const view = await renderViewfinder();
      act(() => view.engine.patch(patch));
      expect(plate()).toBe('Not ready');
      expect(screen.getByLabelText(`${chip}: not ready`)).toBeTruthy();
      expect(screen.getByText(reason)).toBeTruthy();
      expect(screen.getByText(line)).toBeTruthy();
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
    },
  );

  it('disables Go live at the warming deadline with nothing else changing (Review Focus 4)', async () => {
    const view = await renderViewfinder();
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000));
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText('Code timed out — ask the organiser for a new one')).toBeTruthy();
    expect(screen.getByLabelText('Code: not ready')).toBeTruthy();
    expect(screen.getByText('Code timed out')).toBeTruthy();
    expect(screen.queryByText(/Go live by/)).toBeNull();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  it('keeps Go live a moment before the deadline', async () => {
    const view = await renderViewfinder();
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000 - 1));
      vi.advanceTimersByTime(10 * 60_000 - 1);
    });
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    expect(screen.getByText('Go live by 14:10')).toBeTruthy();
  });

  // M8: Android pauses JS timers with the host, so a phone locked across the
  // deadline comes back before its timer fires. The return re-reads the clock.
  it('re-reads the deadline on the return to the foreground, timer or not', async () => {
    const view = await renderViewfinder();
    view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000));
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    act(() => view.foreground.fire());
    expect(screen.getByText('Code timed out — ask the organiser for a new one')).toBeTruthy();
    expect(screen.getByLabelText('Code: not ready')).toBeTruthy();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  it('keeps Go live on a return before the deadline, and still times out on it', async () => {
    const view = await renderViewfinder();
    view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000 - 1));
    act(() => view.foreground.fire());
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000));
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByLabelText('Code: not ready')).toBeTruthy();
  });

  it('opens already timed out when the deadline passed before the visit', async () => {
    await renderViewfinder(
      {},
      {
        prepare: (fakes) => fakes.setNow(new Date(TEST_NOW.getTime() + 11 * 60_000)),
      },
    );
    expect(screen.getByText('Code timed out — ask the organiser for a new one')).toBeTruthy();
  });

  it('never arms with a code it cannot read, says so, and offers Home', async () => {
    const view = await renderViewfinder({}, { saved: savedStreamCode({ raw: '{"v":2}' }) });
    expect(arms(view)).toHaveLength(0);
    expect(screen.getByText(UNUSABLE)).toBeTruthy();
    expect(plate()).toBe('Not ready');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(events(view).filter((event) => event === 'stream.unusable-code')).toHaveLength(1);
    // Not armed, so Go live gives no chip's reason: the code did not time out.
    expect(screen.queryByText('Code timed out')).toBeNull();
    expect(goLive().getAttribute('aria-disabled')).toBe('true');
  });

  // Native refuses a start that is not armed; the control never sends one.
  // M2: with no session there is no camera of ours, whatever its frames say.
  // The column's own kind gate is pinned in StreamColumn.test.tsx.
  it('keeps Go live off until the engine is armed: there is no camera yet', async () => {
    const view = await renderViewfinder();
    act(() => {
      view.engine.forceState({ kind: 'idle' });
      view.engine.patch({ cameraReady: true, networkReachable: true, audioLevel: 0.4 });
    });
    expect(screen.getByLabelText('Camera: not ready')).toBeTruthy();
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  // Carry 6: the problem's name, never the error object or the code itself.
  it('records why the code cannot be used, and only that', async () => {
    const view = await renderViewfinder({}, { saved: savedStreamCode({ raw: '{"v":2}' }) });
    const unusable = readRecord(view.record).filter((e) => e.event === 'stream.unusable-code');
    expect(unusable.map((entry) => entry.fields)).toEqual([{ problem: 'unreadable-code' }]);
    expect(view.record.lines().join('\n')).not.toContain('"v":2');
  });

  it('never arms twice on one visit, even if the engine drops back to idle', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'idle' }));
    expect(arms(view)).toHaveLength(1);
  });

  it.each(['armed-ready', 'live'] as const)(
    'does not arm an engine that is already %s',
    async (scene) => {
      const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene(scene) });
      expect(arms(view)).toHaveLength(0);
    },
  );

  // Ruling I3: a session native reopened with no descriptor cannot go live,
  // and plate, line, chip and reason all say so, none of them "timed out".
  it('reads not ready everywhere when armed with no session details', async () => {
    await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('armed-ready') });
    expect(plate()).toBe('Not ready');
    expect(screen.getByText('Waiting for the session details.')).toBeTruthy();
    expect(screen.getByText('No session details')).toBeTruthy();
    expect(screen.getByLabelText('Code: not ready')).toBeTruthy();
    expect(screen.queryByText(/timed out/i)).toBeNull();
  });

  // The camera ruling and M2: another app's take before air is named, with no
  // slate claim, and nothing beside it reads ready.
  it('reads not ready with the camera in use by another app before air', async () => {
    const view = await renderViewfinder();
    expect(plate()).toBe('Ready');
    act(() => view.engine.setCamera('taken'));
    expect(plate()).toBe('Not ready');
    expect(screen.getByText('Camera in use by another app')).toBeTruthy();
    expect(screen.queryByText(/slate/i)).toBeNull();
    expect(screen.getByLabelText('Camera: not ready')).toBeTruthy();
    expect(screen.getByText('Camera not ready')).toBeTruthy();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  it('leaves for Home on Back while armed, with nothing to stop', async () => {
    const view = await renderViewfinder();
    act(() => void view.back.press());
    // The leave's write settles on microtasks; fake timers hold waitFor's own clock.
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(view.navigation.current()).toBe('home');
    expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
  });

  it('reads in French', async () => {
    await renderViewfinder({ deviceLanguages: ['fr'] });
    expect(plate()).toBe('Prêt');
    expect(screen.getByText('Prêt. Maintenez le bouton 3 secondes.')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : prêt')).toBeTruthy();
    expect(screen.getByText('Direct avant 14:10')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});

/**
 * Ruling 6 at the arm (carry 7): the saved descriptor's URLs are checked again
 * against the build's one host. A record saved under the other environment
 * never sends its Bearer anywhere; a foreign overlay is simply no overlay.
 */
describe('the saved descriptor, checked again before it arms', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never arms a code whose heartbeat is on another host, and says why', async () => {
    const descriptor = sampleDescriptor(FIXTURE_NOW, {
      heartbeatUrl: `${PRODUCTION}/api/capture/sessions/fake/heartbeat`,
    });
    const view = await renderViewfinder({}, { saved: savedStreamCode({ descriptor }) });
    expect(arms(view)).toHaveLength(0);
    expect(screen.getByText(UNUSABLE)).toBeTruthy();
    const unusable = readRecord(view.record).filter((e) => e.event === 'stream.unusable-code');
    expect(unusable.map((entry) => entry.fields)).toEqual([{ problem: 'foreign-heartbeat' }]);
  });

  it('arms without the overlay when only the overlay is on another host', async () => {
    const descriptor = sampleDescriptor(FIXTURE_NOW, {
      overlayUrl: `${PRODUCTION}/overlay/fixtures/fake-fixture`,
    });
    const view = await renderViewfinder({}, { saved: savedStreamCode({ descriptor }) });
    const [arm] = arms(view);
    expect(arm?.kind === 'arm' && arm.session.descriptor.overlayUrl).toBeNull();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    expect(plate()).toBe('Ready');
  });
});

/** Carry 8: no overlay to show is said on the top strip, and recorded once. */
describe('the score preview while arming', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the overlay page with no delay, and records nothing wrong', async () => {
    const view = await renderViewfinder();
    expect(screen.getByTestId('overlay').dataset.url).toBe(
      'https://stg.seazn.club/overlay/fixtures/fake-fixture?delay=0',
    );
    expect(events(view).filter((event) => event.startsWith('overlay.'))).toEqual([]);
  });

  it('says the preview failed when the descriptor has no overlay, and records it once', async () => {
    const descriptor = sampleDescriptor(FIXTURE_NOW, { overlayUrl: null });
    const view = await renderViewfinder({}, { saved: savedStreamCode({ descriptor }) });
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(events(view).filter((event) => event === 'overlay.absent')).toHaveLength(1);
    expect(plate()).toBe('Ready');
  });
});
