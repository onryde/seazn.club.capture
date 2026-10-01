import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReopenGate } from '@/hooks/useReopenGate';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { font } from '@/ui/theme/tokens';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { wrapperFor } from '../../../test/renderWithPorts';

const plate = () => screen.getByTestId('tally-plate').textContent;
const scanAnother = () => screen.getByRole('button', { name: 'Scan another' });

describe('Ended (spec §4)', () => {
  it.each([
    ['stopped', 'You stopped the broadcast.'],
    ['stopped-by-organiser', 'Stopped by the organiser'],
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
    const written = new Promise<void>((resolve) => {
      release = resolve;
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
    expect(screen.getByText('Live 0:12:34')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nog een scannen' })).toBeTruthy();
  });
});

describe('reopening while live (spec §1: the engine wins)', () => {
  it('comes back to the live viewfinder without arming again', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(view.engine.intents.some((intent) => intent.kind === 'arm')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' }),
    ).toBeTruthy();
  });

  it('never arms after that live session ends: Ended waits for the operator', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    act(() => view.engine.scene('stopped'));
    expect(plate()).toBe('Ended');
    expect(view.engine.intents.some((intent) => intent.kind === 'arm')).toBe(false);
  });
});

/**
 * N4 (owner-visible): the code expires while the phone sits on a stopped
 * Ended screen, and the operator comes back to the app. The reopen gate sends
 * them Home with the expiry named; the next code they scan must open on Arm,
 * never on the old broadcast's Ended screen.
 */
describe('a code that expired on a stopped Ended screen (N4)', () => {
  it('lets the next code scanned arm, never reopening the old Ended screen', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    renderHook(() => useReopenGate(true), { wrapper: wrapperFor(view) });
    expect(plate()).toBe('Ended');
    const later = new Date(view.ports.clock().getTime() + 5 * 3600_000);
    view.setNow(later);
    act(() => view.foreground.fire());
    await waitFor(() => expect(view.navigation.current()).toBe('home'));

    // M1: `router.replace('/')` unmounts the viewfinder before Home opens
    // anything, so the old visit can neither arm the new code nor adopt it.
    cleanup();
    expect(view.engine.intents.map((intent) => intent.kind)).toEqual(['arm', 'reset']);

    // Home opens a new code (spec §2), and the viewfinder mounts for it.
    const fresh = savedStreamCode({
      raw: captureRaw({ exp: epochSeconds(new Date(later.getTime() + 4 * 3600_000)) }),
      savedAt: later,
      expiresAt: new Date(later.getTime() + 4 * 3600_000),
      descriptor: sampleDescriptor(later),
    });
    await act(() => view.ports.modeStore.open(fresh));
    expect(view.engine.intents.map((intent) => intent.kind)).toEqual(['arm', 'reset']);
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await act(async () => undefined);

    expect(view.engine.intents.map((intent) => intent.kind)).toEqual(['arm', 'reset', 'arm']);
    expect(plate()).not.toBe('Ended');
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
  });
});
