import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import en from '@/i18n/en.json';
import { readRecord } from '../../../test/fakePorts';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
/** A3: Stop ends the broadcast and the pairing, and its screen-reader label says so. */
/** Stop before the first frame: it ends the broadcast, not the pairing (owner decision 1, 2026-10-05). */
const stop = () => screen.getByRole('button', { name: 'Hold to stop' });
/** en['stream.status.waitingGoLive'] with FAKE_PAIRING's destination, written out. */
const WAITING = 'Waiting for Go live · YouTube · Fake CC';
const plate = () => screen.getByTestId('tally-plate').textContent;
const kinds = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  view.engine.intents.map((intent) => intent.kind);
const events = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  readRecord(view.record).map((entry) => entry.event);

const OVERLAY_FAILED = 'Score preview failed — the broadcast is not affected';
const SCORE_AHEAD = 'You see the score slightly ahead of viewers';

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

  it('shows Ready with the three chips, AUTO, the waiting line and the match label', async () => {
    await renderViewfinder();
    expect(plate()).toBe('Ready');
    expect(goLive().getAttribute('aria-disabled')).not.toBe('true');
    // en['stream.status.waitingGoLive'] with FAKE_PAIRING's destination, written out.
    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Mic: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    // The fake's pairing allows automatic mode, and the scan sent the switch on.
    expect(screen.getByText(en['stream.chip.auto'])).toBeTruthy();
    // The code chip and "Go live by" went with the go-live deadline (amendment §2).
    expect(screen.queryByLabelText(/^Code:/)).toBeNull();
    expect(screen.queryByText(/Go live by/)).toBeNull();
    // Spec §2: the strip's label is one accessible name, the label as typed, split into its sides on screen.
    expect(screen.getByLabelText('Seazn XI v Fake CC').getAttribute('data-testid')).toBe(
      'match-label',
    );
  });

  it('starts once after a full 3 s hold on Go live', async () => {
    const view = await renderViewfinder();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.filter((intent) => intent.kind === 'start')).toHaveLength(1);
    // Connecting now: Stop has taken Go live's place (A3); never live, it does not say it unpairs (owner decision 1).
    expect(stop()).toBeTruthy();
  });

  it.each([
    ['camera', 'Camera', 'Camera not ready'],
    ['network', 'Network', 'No network'],
    ['sound', 'Mic', 'Mic not available'],
  ] as const)(
    'blocks Go live when native says %s is not ready, and says why at the control',
    async (check, chip, reason) => {
      const view = await renderViewfinder();
      act(() => view.engine.setReady({ [check]: false }));
      expect(plate()).toBe('Not ready');
      expect(screen.getByLabelText(`${chip}: not ready`)).toBeTruthy();
      expect(screen.getByText(reason)).toBeTruthy();
      // The line says what it waits for; readiness is the chips' and the blocker's.
      expect(screen.getByText(WAITING)).toBeTruthy();
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
    },
  );

  // Amendment §2: a flat phone has no chip; it blocks Go live and says so.
  it('blocks Go live on a phone not held sideways, with no chip for it', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setReady({ held: false }));
    expect(plate()).toBe('Not ready');
    expect(goLive().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(en['stream.blocker.held'])).toBeTruthy();
    expect(screen.getByText(WAITING)).toBeTruthy();
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Mic: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  it('shows no AUTO when the organiser does not allow automatic mode', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setPairing({ autoAllowed: false }));
    expect(screen.queryByText(en['stream.chip.auto'])).toBeNull();
  });

  it('waits for a destination while the organiser has picked none', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setPairing({ destinationName: null }));
    expect(screen.getByText(en['stream.status.waitingDestination'])).toBeTruthy();
  });

  it('names the destination cut at 24 characters (PV29)', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setPairing({ destinationName: 'YouTube · A Very Long Club Name CC' }));
    expect(screen.getByText('Waiting for Go live · YouTube · A Very Long C…')).toBeTruthy();
  });

  it('says when it starts, in the venue’s zone, and nothing once it is going live', async () => {
    const view = await renderViewfinder();
    expect(screen.queryByText(/^Starts/)).toBeNull();
    act(() => view.engine.setPairing({ scheduledStart: new Date('2026-10-03T13:30:00Z') }));
    // Europe/London in October is BST: 13:30Z reads 14:30, the phone's zone, so no zone name.
    expect(screen.getByText('Starts 14:30')).toBeTruthy();
    act(() => view.engine.hear({ word: 'go-live', cause: 'organiser' }));
    expect(screen.queryByText(/^Starts/)).toBeNull();
    expect(screen.queryByText(en['stream.chip.auto'])).toBeNull();
  });

  // Spec decision 13: the venue's zone, named when it is not the phone's (Europe/London here).
  it('says the start in a venue zone that is not the phone’s, and names it', async () => {
    const view = await renderViewfinder();
    act(() =>
      view.engine.setPairing({
        scheduledStart: new Date('2026-10-03T13:30:00Z'),
        venueTimezone: 'Europe/Paris',
      }),
    );
    expect(screen.getByText('Starts 15:30 CEST')).toBeTruthy();
  });

  it('says a refused start, then how the last broadcast ended', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('paired-refused'));
    expect(screen.getByText(en['stream.status.refusedCredit'])).toBeTruthy();
    act(() => view.engine.scene('paired-after-organiser-stop'));
    expect(screen.getByText(en['stream.status.stoppedOrganiser'])).toBeTruthy();
  });

  it('a remote Go live on a flat phone waits, says why, then goes live once held', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setReady({ held: false }));
    act(() => view.engine.hear({ word: 'go-live', cause: 'organiser' }));
    expect(stop()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Go live/ })).toBeNull();
    expect(screen.getByText(en['stream.status.notReadyHeld'])).toBeTruthy();
    act(() => view.engine.setReady({ held: true }));
    expect(view.engine.getSnapshot().state.kind).toBe('connecting');
    expect(screen.getByText(en['stream.status.connecting'])).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(plate()).toBe('Live');
    expect(screen.getByText(en['stream.status.live'])).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
  });

  it('says it is retrying a start it cannot fetch, with Stop offered', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('arming-retrying'));
    expect(screen.getByText(en['stream.status.startRetrying'])).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  it.each([
    ['organiser', 'stream.status.goingLiveOrganiser'],
    ['automatic', 'stream.status.goingLiveMatch'],
  ] as const)('a remote Go live from the %s says who started it', async (cause, key) => {
    const view = await renderViewfinder();
    act(() => view.engine.setReady({ sound: false }));
    act(() => view.engine.hear({ word: 'go-live', cause }));
    // Armed, not ready: the not-ready line outranks who started it.
    expect(screen.getByText(en['stream.status.notReadySound'])).toBeTruthy();
    act(() => view.engine.forceState({ kind: 'arming', cause, retrying: false }));
    expect(screen.getByText(en[key])).toBeTruthy();
  });

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
    expect(screen.getByText('En attente du direct · YouTube · Fake CC')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : OK')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});

/** Carry 8, final review I-2: no overlay to show is no failure; a failed load is. */
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

  // Final review I-2: no overlay URL is the server's "not entitled" (spec :61,
  // :400), not a failure: no caption at all, no warn, one info line.
  it('says nothing on the top strip when the org is not entitled to an overlay', async () => {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ overlayUrl: null }) },
    );
    act(() => view.engine.patch({ charging: true }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.queryByText(SCORE_AHEAD)).toBeNull();
    const overlayLines = readRecord(view.record).filter((entry) =>
      entry.event.startsWith('overlay.'),
    );
    expect(overlayLines.map((entry) => `${entry.level} ${entry.event}`)).toEqual([
      'info overlay.none',
    ]);
    expect(plate()).toBe('Ready');
  });

  it('writes the not-entitled line once when effects run twice (StrictMode)', async () => {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ overlayUrl: null }), strict: true },
    );
    expect(events(view).filter((event) => event.startsWith('overlay.'))).toEqual(['overlay.none']);
  });

  it('tells no overlay apart from one that failed to load', async () => {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ overlayUrl: null }) },
    );
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    act(() =>
      view.engine.setPairing({
        overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q',
      }),
    );
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    expect(events(view).filter((event) => event.startsWith('overlay.'))).toEqual([
      'overlay.none',
      'overlay.failed',
    ]);
  });

  // Final review I-2, staging evidence (2026-10-05): the pair intent carries no
  // overlay, so native's pairing names none, and no label, until the first beat
  // answers, about half a second after paired. That null is not yet known, never
  // "none": nothing is said of it, and the overlay loads when it comes. A failure
  // belongs to its URL; a URL taken away takes the overlay with it.
  it('loads an overlay that arrives after the pair, and follows it through a failure and its removal', async () => {
    const STAGING = 'https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q?style=bug&key=k3y-0123';
    const OTHER = 'https://stg.seazn.club/overlay/fixtures/other-fixture';
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ label: '', overlayUrl: null }) },
    );
    act(() => view.engine.patch({ charging: true }));
    const overlayLines = () =>
      readRecord(view.record)
        .filter((entry) => entry.event.startsWith('overlay.'))
        .map((entry) => `${entry.level} ${entry.event}`);
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(overlayLines()).toEqual([]);
    act(() => view.engine.setPairing({ label: 'Seazn XI v Fake CC', overlayUrl: STAGING }));
    expect(screen.getByTestId('overlay').dataset.url).toBe(`${STAGING}&delay=0`);
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.getByText(SCORE_AHEAD)).toBeTruthy();
    expect(overlayLines()).toEqual([]);
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText(OVERLAY_FAILED)).toBeTruthy();
    act(() => view.engine.setPairing({ overlayUrl: OTHER }));
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.getByTestId('overlay').dataset.url).toBe(`${OTHER}?delay=0`);
    act(() => view.engine.setPairing({ overlayUrl: null }));
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByText(OVERLAY_FAILED)).toBeNull();
    expect(screen.queryByText(SCORE_AHEAD)).toBeNull();
    expect(overlayLines()).toEqual(['warn overlay.failed', 'info overlay.none']);
    // One line each time a showing begins with none, never one per render.
    act(() => view.engine.setPairing({ overlayUrl: OTHER }));
    act(() => vi.advanceTimersByTime(5000));
    act(() => view.engine.setPairing({ overlayUrl: null }));
    expect(overlayLines()).toEqual([
      'warn overlay.failed',
      'info overlay.none',
      'info overlay.none',
    ]);
  });
});
