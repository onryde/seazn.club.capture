import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STORE_KEYS } from '@/services/modeStore';
import { renderViewfinder } from '../../../test/renderViewfinder';

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

  it('Scan another forgets the spent code, goes Home, and asks Home to scan', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    fireEvent.click(scanAnother());
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(view.ports.homeIntent.takeScan()).toBe(true);
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
