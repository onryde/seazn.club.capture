import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { HOLD_MS } from '@/hooks/useHold';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { wrapperFor } from '../../../test/renderWithPorts';

const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const home = () => screen.getByRole('button', { name: 'Home' });
const FAILED = { kind: 'ended', reason: 'fatal-error', durationMs: 5000 } as const;

/** Lets the leave's write settle: fake timers hold waitFor's own clock. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

/** Native already holding this code's session, as a reopen finds it (batch 9 I1: matched by sid). */
const holding = (scene: FakeScene) => (fakes: FakePorts) => {
  fakes.engine.scene(scene);
  fakes.engine.setDescriptor(savedStreamCode().descriptor);
};

/**
 * The next visit to the viewfinder over the same phone, as the reopen gate
 * makes it after a return to the foreground: an armed or live engine goes to
 * the stream route whatever is saved (S0's reopenTarget).
 */
async function revisit(fakes: FakePorts) {
  cleanup();
  render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
  fakes.navigation.go('stream');
  await act(async () => undefined);
}

/**
 * Ruling I1: a visit that finds native's session adopts it as armed for its
 * code, and a visit never arms during or after a leave it started. The engine
 * wins at reopen (spec §1): nothing under Home is ever armed by the way out.
 */
describe('a visit never arms on its way out (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arm, Home, back, go live, fail, Home: nothing is armed under Home', async () => {
    const view = await renderViewfinder();
    fireEvent.click(home());
    await settle();
    expect(view.navigation.current()).toBe('home');
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'armed' });

    await revisit(view);
    pressIn(screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    act(() => view.engine.forceState(FAILED));
    fireEvent.click(home());
    await settle();

    expect(view.navigation.current()).toBe('home');
    expect(kinds(view)).toEqual(['arm', 'start', 'reset']);
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'idle' });
  });

  it.each([
    ['Home', 'Home'],
    ['Scan another', 'Scan another'],
  ])('a reopen on a live session that then fails leaves by %s without arming', async (_, name) => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    act(() => view.engine.forceState(FAILED));
    fireEvent.click(screen.getByRole('button', { name }));
    await settle();
    expect(view.navigation.current()).toBe('home');
    expect(kinds(view)).toEqual(['reset']);
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'idle' });
  });

  it('a reopen on an armed session leaves it armed, and arms nothing', async () => {
    const view = await renderViewfinder({}, { prepare: holding('armed-ready') });
    fireEvent.click(home());
    await settle();
    expect(kinds(view)).toEqual([]);
    expect(view.engine.getSnapshot().state).toEqual({ kind: 'armed' });
  });

  // The adoption on its own, with no leave: the engine wins at reopen, so its
  // session is this visit's arm and a fall to idle is recovered by Continue.
  // N1: an armed session is adopted as surely as a live one (mutant R30).
  it.each(['armed-ready', 'live'] as const)(
    'adopts a %s session it reopened on: a fall to idle mid-visit is not re-armed',
    async (scene) => {
      const view = await renderViewfinder({}, { prepare: holding(scene) });
      act(() => view.engine.forceState({ kind: 'idle' }));
      await settle();
      expect(view.navigation.current()).toBe('stream');
      expect(kinds(view)).toEqual([]);
    },
  );

  it('never arms a code that loads after the visit started to leave', async () => {
    const fakes = createFakePorts({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
      },
    });
    render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
    fakes.navigation.go('stream');
    act(() => void fakes.back.press());
    await settle();
    await act(() => fakes.ports.modeStore.load());
    // Not vacuous: the code is there to arm with, and the engine is idle.
    expect(fakes.ports.modeStore.getSnapshot()).toMatchObject({
      status: 'ready',
      saved: { codes: { stream: expect.anything() } },
    });
    expect(fakes.engine.getSnapshot().state).toEqual({ kind: 'idle' });
    expect(kinds(fakes)).toEqual([]);
  });

  // N1, the "during" half (mutant R4): a visit has started to leave from the
  // moment its write is asked, not once the write settles.
  it('never arms a code that loads while its leave is still being written', async () => {
    const fakes = createFakePorts({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
      },
    });
    const written = vi
      .spyOn(fakes.ports.modeStore, 'setActive')
      .mockReturnValue(new Promise<void>(() => undefined));
    render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
    fakes.navigation.go('stream');
    act(() => void fakes.back.press());
    await act(() => fakes.ports.modeStore.load());
    // Still leaving: the write was asked and never settles.
    expect(written).toHaveBeenCalledWith(null);
    expect(fakes.navigation.current()).toBe('stream');
    expect(fakes.ports.modeStore.getSnapshot()).toMatchObject({
      status: 'ready',
      saved: { codes: { stream: expect.anything() } },
    });
    expect(fakes.engine.getSnapshot().state).toEqual({ kind: 'idle' });
    expect(kinds(fakes)).toEqual([]);
  });
});
