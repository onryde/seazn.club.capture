import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { HOLD_MS } from '@/hooks/useHold';
import { useReopenGate } from '@/hooks/useReopenGate';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { font } from '@/ui/theme/tokens';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { pairCode } from '../../../test/pairCode';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { flush, intentKinds, launchApp, scanFromHome } from '../../../test/routedApp';
import { wrapperFor } from '../../../test/renderWithPorts';

const plate = () => screen.getByTestId('tally-plate').textContent;
const scanAnother = () => screen.getByRole('button', { name: 'Scan another' });

describe('Ended (spec §4)', () => {
  it.each([
    ['stopped', 'You stopped the broadcast.'],
    ['fatal', 'Something failed. Your code is kept.'],
  ] as const)('%s shows the time on air and how it ended', async (scene, line) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(plate()).toBe('Ended');
    expect(screen.getByText('On air 0:12:34')).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Press and hold/ })).toBeNull();
    expect(scanAnother()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  // Amendment §2, The operator's Stop: the code is forgotten, so the next
  // broadcast needs a rescan. A permanent failure keeps the code, and says so.
  it.each([
    ['stopped', 'You stopped the broadcast.', true],
    ['fatal', 'Something failed. Your code is kept.', false],
  ] as const)('%s says to scan the code again: %s', async (scene, line, again) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(screen.getByText(line)).toBeTruthy();
    const scanAgain = screen.queryByText('Scan the code again for the next broadcast');
    expect(scanAgain !== null).toBe(again);
  });

  it('says to scan again after a Stop that never went live too', async () => {
    const view = await renderViewfinder();
    act(() =>
      view.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: null }),
    );
    expect(screen.getByText('Never went live')).toBeTruthy();
    expect(screen.getByText('Scan the code again for the next broadcast')).toBeTruthy();
  });

  // Carry 16: plan B's `durationMs` is null only when the session never went live.
  it('says it never went live when it ended before the first frame, with no time on air', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    expect(screen.getByText('Never went live')).toBeTruthy();
    expect(screen.queryByText(/^On air/)).toBeNull();
  });

  it('reads the time on air native reports, not a clock of its own', async () => {
    const view = await renderViewfinder();
    act(() =>
      view.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: 3_723_000 }),
    );
    expect(screen.getByText('On air 1:02:03')).toBeTruthy();
  });

  // M5: a session that ended inside its first second did go live.
  it('reads a zero time on air as on air, never as never live', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: 0 }));
    expect(screen.getByText('On air 0:00:00')).toBeTruthy();
    expect(screen.queryByText('Never went live')).toBeNull();
  });

  it('Scan another forgets the spent code, goes Home, and asks Home to scan', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    fireEvent.click(scanAnother());
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(view.ports.homeIntent.takeScan()).toBe(true);
  });

  // M9: the request is made only by a leave that goes Home, so a leave
  // cancelled on air never leaves a scan waiting for the next Home.
  it('asks Home for nothing when the broadcast is back on air before it leaves', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    let release = () => undefined as void;
    const written = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    vi.spyOn(view.ports.modeStore, 'forget').mockImplementation(() => written);
    fireEvent.click(scanAnother());
    act(() =>
      view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: Date.now() }),
    );
    await act(async () => release());
    expect(view.navigation.current()).toBe('stream');
    expect(view.ports.homeIntent.takeScan()).toBe(false);
  });

  it('leaves once for a double press', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    const forget = vi.spyOn(view.ports.modeStore, 'forget');
    const button = scanAnother();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(forget).toHaveBeenCalledTimes(1);
    expect(view.engine.intents.filter((intent) => intent.kind === 'reset')).toHaveLength(1);
  });

  it('Home leaves without asking Home to scan', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.ports.homeIntent.takeScan()).toBe(false);
  });

  // M25: Geist Mono carries numerals in tables only; these are sentences.
  it('sets how long it was on air, or that it never was, in the status face', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    expect(getComputedStyle(screen.getByText('On air 0:12:34')).fontFamily).toBe(font.body);
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    expect(getComputedStyle(screen.getByText('Never went live')).fontFamily).toBe(font.body);
  });

  it('reads in Dutch, within the column', async () => {
    const view = await renderViewfinder({ deviceLanguages: ['nl'] });
    act(() => view.engine.scene('stopped'));
    expect(screen.getByText('Zendtijd 0:12:34')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nog een scannen' })).toBeTruthy();
  });
});

const pairs = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  view.engine.intents.filter((intent) => intent.kind === 'pair');

describe('reopening while live (spec §1: the engine wins)', () => {
  it('comes back to the live viewfinder without pairing again', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    // The one pair is the scan's, before the visit (renderViewfinder's default).
    expect(pairs(view)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
  });

  it('never pairs after that live session ends: Ended waits for the operator', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    act(() => view.engine.scene('stopped'));
    expect(plate()).toBe('Ended');
    expect(pairs(view)).toHaveLength(1);
  });
});

/**
 * N4 (owner-visible): the code expires while the phone sits on a stopped
 * Ended screen, and the operator comes back to the app. The reopen gate sends
 * them Home with the expiry named; the next code they scan must open paired,
 * never on the old broadcast's Ended screen.
 */
describe('a code that expired on a stopped Ended screen (N4)', () => {
  it('lets the next code scanned pair, never reopening the old Ended screen', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    renderHook(() => useReopenGate(true), { wrapper: wrapperFor(view) });
    expect(plate()).toBe('Ended');
    const later = new Date(view.ports.clock().getTime() + 5 * 3600_000);
    view.setNow(later);
    act(() => view.foreground.fire());
    await waitFor(() => expect(view.navigation.current()).toBe('home'));

    // M1: `router.replace('/')` unmounts the viewfinder before Home opens
    // anything, so the old visit can neither pair the new code nor adopt it.
    cleanup();
    expect(view.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'reset']);

    // Home opens a new code (spec §2) and pairs it, and the viewfinder mounts for it.
    const fresh = savedStreamCode({
      raw: captureRaw({ exp: epochSeconds(new Date(later.getTime() + 4 * 3600_000)) }),
      savedAt: later,
      expiresAt: new Date(later.getTime() + 4 * 3600_000),
    });
    await act(() => view.ports.modeStore.open(fresh));
    act(() => pairCode(view.engine, fresh));
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await act(async () => undefined);

    // The visit itself sends nothing: the third intent is Home's pair.
    expect(view.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'reset', 'pair']);
    expect(plate()).toBe('Ready');
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
  });
});

/**
 * C4b-I1 (spec, Ended; amendment, The engine port): the follow forgets the
 * code at the operator's Stop, so by the time they leave Ended no saved code
 * owns the session. Nothing saved, it is nobody's, the gate's own orphan rule,
 * and the leave clears it: native must not hold an Ended session until the
 * next foreground or scan.
 */
describe('leaving Ended after the operator’s Stop, with the code already forgotten (C4b-I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const saved = savedStreamCode();

  it.each(['Home', 'Scan another'])('%s sends exactly one reset', async (button) => {
    const app = await launchApp({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
      },
      prepare: (fakes) => pairCode(fakes.engine, saved),
    });
    act(() => app.engine.send({ kind: 'start' }));
    await flush(5_000);
    act(() => app.engine.send({ kind: 'stop' }));
    await flush();
    expect(app.engine.getSnapshot().state).toMatchObject({
      kind: 'ended',
      reason: 'operator-stopped',
    });
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    const before = app.engine.intents.length;
    fireEvent.click(screen.getByRole('button', { name: button }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(intentKinds(app).slice(before)).toEqual(['reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });
});

/**
 * Owner decision 1 (2026-10-05): the operator's Stop before the first frame ends the broadcast, not the pairing.
 * Through the whole app, with the engine follow and the reopen gate: the code stays saved, /stream stays on Ready
 * with Go live offered again, and the line says the stream stopped. Stop says which it does to a screen reader: no
 * "and unpair" until the broadcast is live, when a Stop still ends the pairing and Ended asks for a rescan.
 */
describe('a Stop before live (owner decision 1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const IN_TWO_HOURS = new Date(Date.now() + 2 * 3600_000);
  const GO_LIVE = 'Go live. Press and hold for 3 seconds.';
  const hold = async (name: string) => {
    pressIn(screen.getByRole('button', { name }));
    await flush(HOLD_MS);
    await flush();
  };

  it('keeps the pairing and the code: back on Ready, Go live offered again, the stream said stopped', async () => {
    const app = await launchApp();
    await scanFromHome(app, captureRaw({ exp: epochSeconds(IN_TWO_HOURS) }));
    expect(app.nav.current()).toBe('stream');
    // The organiser's Go live with the camera not ready: Armed, held and never live, for as long as the hold takes
    // (a start of the operator's own goes live a second on, before a 3 s hold ends).
    act(() => app.engine.setReady({ camera: false }));
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(app.engine.getSnapshot().state.kind).toBe('armed');
    expect(screen.queryByRole('button', { name: 'Hold to stop and unpair' })).toBeNull();
    await hold('Hold to stop');
    expect(intentKinds(app).slice(-1)).toEqual(['stop']);
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    expect(app.nav.current()).toBe('stream');
    expect(screen.getByText('Stream stopped — waiting for Go live')).toBeTruthy();
    expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(intentKinds(app)).not.toContain('unpair');
  });

  it('once live, Stop says it unpairs, and ends the pairing with a rescan asked', async () => {
    const app = await launchApp();
    await scanFromHome(app, captureRaw({ exp: epochSeconds(IN_TWO_HOURS) }));
    await hold(GO_LIVE);
    await flush(1_000);
    expect(app.engine.getSnapshot().state.kind).toBe('publishing');
    expect(screen.queryByRole('button', { name: 'Hold to stop' })).toBeNull();
    await hold('Hold to stop and unpair');
    expect(app.engine.getSnapshot().state).toMatchObject({
      kind: 'ended',
      reason: 'operator-stopped',
    });
    expect(screen.getByText('Scan the code again for the next broadcast')).toBeTruthy();
  });
});
