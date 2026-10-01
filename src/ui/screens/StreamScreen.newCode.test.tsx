import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { EngineIntent } from '@/engine/CaptureEnginePort';
import { HOLD_MS } from '@/hooks/useHold';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import type { FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, FIXTURE_NOW, FIXTURE_SID } from '../../../test/fixtures/wire';
import { holdIntents } from '../../../test/holdIntents';
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

const SLOT_TWO_STREAM_ID = 'fake-stream-id-slot-2';

/** The same session's second camera: same sid, slot 2, its own credential. Made-up values. */
const slotTwo = (): SavedCode =>
  savedStreamCode({
    raw: captureRaw({
      slot: 2,
      cred: {
        srt: {
          url: 'srt://ingest.example:778',
          streamId: SLOT_TWO_STREAM_ID,
          passphrase: 'fake-pass-0002',
          latencyMs: 2000,
        },
        rtmps: { url: 'rtmps://ingest.example:443/live/', streamKey: 'fake-key-0002' },
      },
    }),
    slot: 2,
  });

const REISSUED_TOKEN = 'fake-token-reissued-00000000000';
const REISSUED_STREAM_ID = 'fake-stream-id-reissued';

/** The first code re-issued (N2): the same match and slot, a new token and credentials. Made-up values. */
const reissued = (): SavedCode =>
  savedStreamCode({
    raw: captureRaw({
      tok: REISSUED_TOKEN,
      cred: {
        srt: {
          url: 'srt://ingest.example:778',
          streamId: REISSUED_STREAM_ID,
          passphrase: 'fake-pass-0003',
          latencyMs: 2000,
        },
        rtmps: { url: 'rtmps://ingest.example:443/live/', streamKey: 'fake-key-0003' },
      },
    }),
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
 * it is the same code: the same sid, slot (C7, fix round 2) and token (N2, fix
 * round 3). A code opened over another code's armed or ended session, another
 * slot or issue of the same match included, replaces it by native's own path
 * (N1: stop an armed one, reset an ended one, then arm) and arms the new code.
 */
describe('a new code over another code’s session (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms the new code over an armed one, shows its match, and goes live on it', async () => {
    const view = await renderViewfinder();
    expect(screen.getByText(LABEL_A)).toBeTruthy();
    await homeThenOpen(view, codeB());
    // N1: native's own path, one intent per snapshot: stop, reset, arm.
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    expect(lastArm(view)?.session.sid).toBe(SID_B);
    expect(view.engine.getSnapshot().descriptor?.sid).toBe(SID_B);
    expect(screen.getByText(LABEL_B)).toBeTruthy();
    expect(screen.queryByText(LABEL_A)).toBeNull();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm', 'start']);
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

  // Fix round 2 (C7): a different slot is a different camera position and credential.
  it('arms another slot of the same session over the first, and goes live on its credential', async () => {
    const view = await renderViewfinder();
    expect(lastArm(view)?.session.slot).toBe(1);
    await homeThenOpen(view, slotTwo());
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    const armed = lastArm(view)?.session;
    expect(armed?.sid).toBe(FIXTURE_SID);
    expect(armed?.slot).toBe(2);
    expect(armed?.primary).toMatchObject({ transport: 'srt', streamId: SLOT_TWO_STREAM_ID });
    expect(view.engine.getSnapshot().slot).toBe(2);
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm', 'start']);
    expect(view.engine.getSnapshot()).toMatchObject({ state: { kind: 'connecting' }, slot: 2 });
  });

  it('never opens another slot on the first slot’s Ended screen', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    act(() => view.engine.scene('stopped-by-organiser'));
    cleanup();
    await act(() => view.ports.modeStore.open(slotTwo()));
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    expect(lastArm(view)?.session.slot).toBe(2);
    expect(plate()).toBe('Ready');
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
  });

  it('never resets a live session for another slot of it', async () => {
    const one = savedStreamCode();
    const view = await renderViewfinder(
      {},
      {
        saved: slotTwo(),
        prepare: (fakes) => {
          fakes.engine.scene('live');
          fakes.engine.setDescriptor(one.descriptor);
          fakes.engine.setSlot(one.slot);
        },
      },
    );
    expect(kinds(view)).toEqual([]);
    expect(plate()).toBe('Live');
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
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    // Now a third code, unreadable, over B's armed session.
    await homeThenOpen(view, savedStreamCode({ raw: 'not a capture code' }));
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm', 'stop', 'reset']);
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

/**
 * N2 (fix round 3): the same code means the same token too. A re-issued code
 * (same match and slot, a new token and credentials) replaces its first
 * issue's session; the identical code still adopts its own.
 */
describe('a re-issued code over its first issue’s session (N2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms the re-issue over the first issue’s armed session, and goes live on its credential', async () => {
    const view = await renderViewfinder();
    await homeThenOpen(view, reissued());
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    const armed = lastArm(view);
    expect(armed?.session.token).toBe(REISSUED_TOKEN);
    expect(armed?.heartbeat.token).toBe(REISSUED_TOKEN);
    expect(armed?.session.primary).toMatchObject({ streamId: REISSUED_STREAM_ID });
    // FNV-1a 32 of the re-issued token, from an independent Python FNV-1a.
    expect(view.engine.getSnapshot().tokenTag).toBe('2bdf2246');
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm', 'start']);
    expect(view.engine.getSnapshot()).toMatchObject({
      state: { kind: 'connecting' },
      tokenTag: '2bdf2246',
    });
  });

  it('never opens the re-issue on the first issue’s Ended screen, and Home keeps it', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    act(() => view.engine.scene('stopped-by-organiser'));
    cleanup();
    const again = reissued();
    await act(() => view.ports.modeStore.open(again));
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    expect(lastArm(view)?.session.token).toBe(REISSUED_TOKEN);
    expect(plate()).toBe('Ready');
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    expect(view.ports.modeStore.getSnapshot()).toMatchObject({
      saved: { codes: { stream: { raw: again.raw } } },
    });
  });
});

/**
 * N1 and N3 (fix round 3): native answers each intent with a later snapshot.
 * Between them a replacing visit reads not ready, "Waiting for the session
 * details.", and shows nothing of the session it replaces: not its Ended
 * screen, its label or a way to go live on it.
 */
describe('a replace while native has not answered yet (N1, N3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const waitingForDetails = () => {
    expect(plate()).toBe('Not ready');
    expect(screen.getByText('Waiting for the session details.')).toBeTruthy();
    expect(screen.queryByText(LABEL_A)).toBeNull();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scan another' })).toBeNull();
  };

  it('reads not ready while the old armed session is being stopped, and never goes live on it', async () => {
    const view = await renderViewfinder();
    const native = holdIntents(view.engine, ['stop']);
    await homeThenOpen(view, codeB());
    expect(native.held()).toEqual(['stop']);
    expect(view.engine.getSnapshot()).toMatchObject({ state: { kind: 'armed' } });
    waitingForDetails();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(kinds(view)).toEqual(['arm']);
    act(() => native.release());
    await settle();
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    expect(plate()).toBe('Ready');
    expect(screen.getByText(LABEL_B)).toBeTruthy();
    expect(screen.getByTestId('overlay')).toBeTruthy();
  });

  it('never shows the old session’s Ended screen while it is being reset', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    act(() => view.engine.scene('stopped-by-organiser'));
    cleanup();
    const native = holdIntents(view.engine, ['reset']);
    await act(() => view.ports.modeStore.open(codeB()));
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(native.held()).toEqual(['reset']);
    expect(view.engine.getSnapshot().state.kind).toBe('ended');
    waitingForDetails();
    expect(plate()).not.toBe('Ended');
    act(() => native.release());
    await settle();
    expect(kinds(view)).toEqual(['arm', 'reset', 'arm']);
    expect(plate()).toBe('Ready');
  });

  it('reads not ready at idle while the new code’s arm is unanswered', async () => {
    const view = await renderViewfinder();
    const native = holdIntents(view.engine, ['arm']);
    await homeThenOpen(view, codeB());
    expect(native.held()).toEqual(['arm']);
    expect(view.engine.getSnapshot().state.kind).toBe('idle');
    waitingForDetails();
    act(() => native.release());
    await settle();
    expect(plate()).toBe('Ready');
  });

  // Second call: StrictMode runs each effect twice; native still gets each step once.
  it('sends each step once when StrictMode runs its effects twice', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    cleanup();
    const native = holdIntents(view.engine, ['stop']);
    await act(() => view.ports.modeStore.open(codeB()));
    render(<StreamScreen />, { wrapper: wrapperFor(view), reactStrictMode: true });
    view.navigation.go('stream');
    await settle();
    expect(native.held()).toEqual(['stop']);
    act(() => native.release());
    await settle();
    expect(kinds(view)).toEqual(['arm', 'stop', 'reset', 'arm']);
    expect(plate()).toBe('Ready');
  });

  it('keeps the new code when Home is pressed with the old session stopped and not yet reset', async () => {
    const view = await renderViewfinder();
    const native = holdIntents(view.engine, ['reset']);
    const b = codeB();
    await homeThenOpen(view, b);
    expect(view.engine.getSnapshot().state).toMatchObject({
      kind: 'ended',
      reason: 'operator-stopped',
    });
    expect(native.held()).toEqual(['reset']);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    expect(view.navigation.current()).toBe('home');
    expect(view.ports.modeStore.getSnapshot()).toMatchObject({
      saved: { codes: { stream: { raw: b.raw } } },
    });
    expect(kinds(view)).toEqual(['arm', 'stop']);
    expect(native.held()).toEqual(['reset']);
  });
});
