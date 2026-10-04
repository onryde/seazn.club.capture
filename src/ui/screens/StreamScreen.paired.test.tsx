import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import { readRecord } from '../../../test/fakePorts';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const plate = () => screen.getByTestId('tally-plate').textContent;
const kinds = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  view.engine.intents.map((intent) => intent.kind);
const events = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  readRecord(view.record).map((entry) => entry.event);

const OVERLAY_FAILED = 'Score preview failed — the broadcast is not affected';

/**
 * The amendment §2: Home pairs, a visit never does. The viewfinder reads the
 * engine as it finds it and sends nothing until the operator holds a control.
 */
describe('a visit never pairs (amendment §2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends no intent at all to an idle engine', async () => {
    const view = await renderViewfinder({}, { engine: 'idle' });
    expect(view.engine.intents).toEqual([]);
    expect(plate()).toBe('Starting');
  });

  it('sends nothing beyond the scan’s pair, even if the engine drops back to idle', async () => {
    const view = await renderViewfinder();
    expect(kinds(view)).toEqual(['pair']);
    act(() => view.engine.forceState({ kind: 'idle' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(kinds(view)).toEqual(['pair']);
  });
});

describe('the paired viewfinder (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows Ready with the three chips and the match label', async () => {
    await renderViewfinder();
    expect(plate()).toBe('Ready');
    expect(screen.getByText('Ready. Hold Go live for 3 seconds.')).toBeTruthy();
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Sound: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    // The code chip and "Go live by" went with the go-live deadline (amendment §2).
    expect(screen.queryByLabelText(/^Code:/)).toBeNull();
    expect(screen.queryByText(/Go live by/)).toBeNull();
    expect(screen.getByText('Seazn XI v Fake CC')).toBeTruthy();
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
    ['camera', 'Camera', 'Camera not ready', 'Camera not ready yet.'],
    ['network', 'Network', 'No network', 'No network. Check the signal.'],
    ['sound', 'Sound', 'No sound', 'No sound. Check the mic before going live.'],
  ] as const)(
    'blocks Go live when native says %s is not ready, and says why',
    async (check, chip, reason, line) => {
      const view = await renderViewfinder();
      act(() => view.engine.setReady({ [check]: false }));
      expect(plate()).toBe('Not ready');
      expect(screen.getByLabelText(`${chip}: not ready`)).toBeTruthy();
      expect(screen.getByText(reason)).toBeTruthy();
      expect(screen.getByText(line)).toBeTruthy();
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
    },
  );

  // Native refuses a start that is not paired; the control never sends one.
  // M2: with no pairing there is no camera of ours, whatever native's checks say.
  // The column's own kind gate is pinned in StreamColumn.test.tsx.
  it('keeps Go live off until the engine is paired: there is no camera yet', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'idle' }));
    expect(screen.getByLabelText('Camera: not ready')).toBeTruthy();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
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

  it('leaves for Home on Back while paired, with nothing to stop', async () => {
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
    expect(screen.getByText('Prêt. Maintenez Passer en direct 3 secondes.')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : OK')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});

/** Carry 8: no overlay to show is said on the top strip, and recorded once. */
describe('the score preview while paired', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the pairing’s overlay page with no delay, and records nothing wrong', async () => {
    const view = await renderViewfinder();
    expect(screen.getByTestId('overlay').dataset.url).toBe(
      'https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q?delay=0',
    );
    expect(events(view).filter((event) => event.startsWith('overlay.'))).toEqual([]);
  });

  it('says the preview failed when the pairing has no overlay, and records it once', async () => {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ overlayUrl: null }) },
    );
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(events(view).filter((event) => event === 'overlay.absent')).toHaveLength(1);
    expect(plate()).toBe('Ready');
  });
});
