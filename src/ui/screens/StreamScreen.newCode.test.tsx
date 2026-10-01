import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { EngineIntent } from '@/engine/CaptureEnginePort';
import { HOLD_MS } from '@/hooks/useHold';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import type { FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, FIXTURE_NOW } from '../../../test/fixtures/wire';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { wrapperFor } from '../../../test/renderWithPorts';

const SID_B = '5d9c1d0e-0000-4000-8000-00000000000b';
const LABEL_A = 'Seazn XI v Fake CC';
const LABEL_B = 'Example Town v Sample CC';

/** A second, valid code for another match: its own sid, label and descriptor. Made-up values. */
const codeB = (): SavedCode =>
  savedStreamCode({
    raw: captureRaw({ sid: SID_B }),
    descriptor: sampleDescriptor(FIXTURE_NOW, { sid: SID_B, label: LABEL_B }),
  });

const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const lastArm = (fakes: FakePorts) =>
  fakes.engine.intents
    .filter((i): i is Extract<EngineIntent, { kind: 'arm' }> => i.kind === 'arm')
    .at(-1);
const plate = () => screen.getByTestId('tally-plate').textContent;
const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

/** Home, then a code opened there, then the viewfinder mounting for it, as `router.replace` does. */
async function homeThenOpen(fakes: FakePorts, code: SavedCode | null) {
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await settle();
  expect(fakes.navigation.current()).toBe('home');
  cleanup();
  if (code !== null) await act(() => fakes.ports.modeStore.open(code));
  render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
  fakes.navigation.go('stream');
  await settle();
}

/**
 * I1 (fix round 1, owner-visible): a visit adopts native's session only when
 * it is the same code, by sid. A code opened over another code's armed or
 * ended session resets it and arms the new code.
 */
describe('a new code over another code’s session (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms the new code over an armed one, shows its match, and goes live on it', async () => {
    const view = await renderViewfinder();
    expect(screen.getByText(LABEL_A)).toBeTruthy();
    await homeThenOpen(view, codeB());
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    expect(lastArm(view)?.session.sid).toBe(SID_B);
    expect(view.engine.getSnapshot().descriptor?.sid).toBe(SID_B);
    expect(screen.getByText(LABEL_B)).toBeTruthy();
    expect(screen.queryByText(LABEL_A)).toBeNull();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm', 'start']);
    expect(view.engine.getSnapshot().state.kind).toBe('connecting');
    expect(view.engine.getSnapshot().descriptor?.sid).toBe(SID_B);
  });

  it('never opens the new code on the old one’s Ended screen, and Home keeps it', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    // The organiser ends match A while the phone sits on Home.
    act(() => view.engine.scene('stopped-by-organiser'));
    cleanup();
    const b = codeB();
    await act(() => view.ports.modeStore.open(b));
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    expect(plate()).toBe('Ready');
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
    expect(screen.getByText(LABEL_B)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    expect(view.navigation.current()).toBe('home');
    expect(view.ports.modeStore.getSnapshot()).toMatchObject({
      status: 'ready',
      saved: { codes: { stream: { raw: b.raw } } },
    });
  });

  it('adopts its own armed session when the same code is opened again', async () => {
    const view = await renderViewfinder();
    await homeThenOpen(view, null);
    expect(kinds(view)).toEqual(['arm']);
    expect(plate()).toBe('Ready');
    expect(screen.getByText(LABEL_A)).toBeTruthy();
  });

  it('shows its own Ended screen when the same code is opened again', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    act(() => view.engine.scene('stopped-by-organiser'));
    cleanup();
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(kinds(view)).toEqual(['arm']);
    expect(plate()).toBe('Ended');
  });

  it('clears another code’s session for a code it cannot use, and arms nothing', async () => {
    const view = await renderViewfinder();
    await homeThenOpen(view, codeB());
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    // Now a third code, unreadable, over B's armed session.
    await homeThenOpen(view, savedStreamCode({ raw: 'not a capture code' }));
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm', 'reset']);
    expect(view.engine.getSnapshot().state.kind).toBe('idle');
    expect(screen.getByText("This code can't be used. Go Home and scan again.")).toBeTruthy();
  });

  it('never resets a live session, whoever’s code is saved', async () => {
    const view = await renderViewfinder(
      {},
      { saved: codeB(), prepare: (fakes) => fakes.engine.scene('live') },
    );
    expect(kinds(view)).toEqual([]);
    expect(plate()).toBe('Live');
  });
});
