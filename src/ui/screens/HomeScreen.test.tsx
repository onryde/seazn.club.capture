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
import { err } from '@/domain/Result';
import { decodeSavedCode, encodeSavedCode } from '@/domain/mode/savedCode';
import { useHome } from '@/hooks/useHome';
import { useReopenGate } from '@/hooks/useReopenGate';
import type { CodeScannerPort, ScanUnavailableReason } from '@/scanner/CodeScannerPort';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { KV_TIMEOUT_MS, withTimeout } from '@/services/kvTimeout';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { createFetchDescriptorPort, DESCRIPTOR_TIMEOUT_MS } from '@/services/fetchDescriptorPort';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';

const IN_TWO_HOURS = new Date(TEST_NOW.getTime() + 2 * 3600_000);
// 17:40Z is 18:40 in the fake phone's Europe/London zone (BST).
const AT_1840 = new Date('2026-10-03T17:40:00Z');

/** Made-up credentials, v2. */
function streamRaw(exp: Date, slot = 1): string {
  return captureRaw({ exp: epochSeconds(exp), slot });
}

/** A stream code saved by an earlier scan, as the store writes it. */
function savedStream(expiresAt: Date, descriptor = sampleDescriptor(TEST_NOW)): string {
  return encodeSavedCode(savedStreamCode({ raw: streamRaw(expiresAt), expiresAt, descriptor }));
}

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const result = renderWithPorts(<HomeScreen />, options);
  await act(() => result.ports.modeStore.load());
  return result;
}

const EXPIRED_1840 = 'Your Live Stream code expired at 18:40. Scan a new one.';

/** Launch as the root layout does it: the gate decides, then Home renders. */
function GateThenHome() {
  useReopenGate(true);
  return <HomeScreen />;
}

const liveStreamTile = () => screen.getByRole('button', { name: /Live Stream/ });

/** Home under the reopen gate with a session armed: a return to the foreground reopens Live Stream. */
async function armedHome() {
  const fakes = createFakePorts();
  render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
  await waitFor(() => expect(fakes.splash.hides).toBe(1));
  act(() => fakes.engine.forceState({ kind: 'armed' }));
  return fakes;
}
const IDLE = 'Tap a mode, then scan its code.';
const SAVE_FAILED = "Couldn't save on this phone. Try again.";

describe('Home', () => {
  it('shows three tiles, two of them coming soon', async () => {
    await renderHome();
    expect(liveStreamTile()).toBeTruthy();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.getByText(IDLE)).toBeTruthy();
  });

  it('opens Live Stream on a valid stream code and remembers it', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream');
  });

  it('names a scoring code and says it is coming soon, then scans again', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://stg.seazn.club/score/abc123' });
    fireEvent.click(liveStreamTile());
    await screen.findByText('This is a Remote Scoring code');
    expect(screen.getByText('Remote Scoring is coming soon.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(home.scanner.scans).toBe(2));
    expect(home.navigation.current()).toBe('home');
    // Backing out of the second scan leaves Home, not the first scan's answer.
    expect(screen.queryByText('This is a Remote Scoring code')).toBeNull();
  });

  it('gives the expiry time for an expired code', async () => {
    const home = await renderHome();
    home.scanner.queue({
      outcome: 'scanned',
      raw: streamRaw(new Date(TEST_NOW.getTime() - 60_000)),
    });
    fireEvent.click(liveStreamTile());
    await screen.findByText('This code expired at 13:59. Ask the desk for a new one.');
  });

  it("says plainly when it isn't a Seazn code", async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://example.com/menu' });
    fireEvent.click(liveStreamTile());
    await screen.findByText("This isn't a Seazn code.");
  });

  it('shows nothing new when the operator backs out of the scanner', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'cancelled' });
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    expect(screen.getByText(IDLE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
  });

  it('says the scanner is getting ready on its first download', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'unavailable', reason: 'installing' });
    fireEvent.click(liveStreamTile());
    await screen.findByText('Getting the scanner ready… Try again in a moment.');
  });

  it('never opens a second scanner while one is on screen', async () => {
    const home = await renderHome();
    const finish = home.scanner.deferNext();
    fireEvent.click(liveStreamTile());
    fireEvent.click(liveStreamTile());
    fireEvent.click(liveStreamTile());
    await act(async () => finish({ outcome: 'cancelled' }));
    expect(home.scanner.scans).toBe(1);
  });

  it('offers Continue for a left stream with a valid code, and Forget removes it', async () => {
    const home = await renderHome({
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) },
    });
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 1 · code valid till 18:40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByText('Continue Live Stream')).toBeNull());
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('gives the Continue time in the venue’s zone, naming it when it is not the phone’s (spec §2)', async () => {
    const madrid = sampleDescriptor(TEST_NOW, { venueTimezone: 'Europe/Madrid' });
    await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840, madrid) } });
    const detail = screen.getByText(/Slot 1 · code valid till/);
    expect(detail.textContent).toMatch(/19:40/);
    expect(detail.textContent).not.toBe('Slot 1 · code valid till 19:40');
  });

  it('gives the Continue time plainly when the venue is in the phone’s zone', async () => {
    await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) } });
    expect(screen.getByText('Slot 1 · code valid till 18:40')).toBeTruthy();
  });

  it('gives an expiry notice in the venue’s zone', async () => {
    const home = await renderHome();
    await act(() =>
      home.ports.modeStore.expire(['stream'], {
        mode: 'stream',
        expiredAt: AT_1840,
        venueTz: 'Europe/Madrid',
      }),
    );
    const line = screen.getByText(/Your Live Stream code expired at/);
    expect(line.textContent).toMatch(/19:40/);
  });

  it('names the venue’s time when Continue finds the code expired', async () => {
    const madrid = sampleDescriptor(TEST_NOW, { venueTimezone: 'Europe/Madrid' });
    const home = await renderHome({
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840, madrid) },
    });
    home.setNow(new Date(AT_1840.getTime() + 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const line = await screen.findByText(/Your Live Stream code expired at/);
    expect(line.textContent).toMatch(/19:40/);
  });

  it('Continue reopens Live Stream', async () => {
    const home = await renderHome({
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it('offers no Continue for a code that has already expired', async () => {
    const expired = new Date(TEST_NOW.getTime() - 60_000);
    await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: savedStream(expired) } });
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
  });

  it('drops Continue at the next render once the code has expired on screen', async () => {
    const home = await renderHome({
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) },
    });
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    home.setNow(new Date(AT_1840.getTime() + 60_000));
    // Any render of Home will do: the card reads the clock when it renders.
    home.rerender(<HomeScreen />);
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
  });

  it('shows the expiry notice left by the reopen gate', async () => {
    const home = await renderHome();
    await act(() =>
      home.ports.modeStore.expire(['stream'], {
        mode: 'stream',
        expiredAt: AT_1840,
        venueTz: 'Europe/London',
      }),
    );
    expect(
      screen.getByText('Your Live Stream code expired at 18:40. Scan a new one.'),
    ).toBeTruthy();
  });

  // Ruling R13 rewrote this copy so it is true on both unreadable paths.
  it('says when a saved code could not be read', async () => {
    await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: 'garbage' } });
    expect(screen.getByText("Couldn't read saved codes. Scan again to continue.")).toBeTruthy();
  });

  it('clears the expiry notice once the operator taps to scan', async () => {
    const home = await renderHome();
    await act(() =>
      home.ports.modeStore.expire([], {
        mode: 'stream',
        expiredAt: AT_1840,
        venueTz: 'Europe/London',
      }),
    );
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    expect(screen.getByText(IDLE)).toBeTruthy();
  });

  it('clears the unreadable notice once the operator taps to scan', async () => {
    const home = await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: 'garbage' } });
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    expect(screen.getByText(IDLE)).toBeTruthy();
  });

  it('hides the paste field outside development builds', async () => {
    await renderHome({ devTools: false });
    expect(screen.queryByText('Paste a code (development only)')).toBeNull();
    // The field's words are a placeholder, which queryByText never matches.
    expect(screen.queryByPlaceholderText('Paste a code (development only)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use pasted code' })).toBeNull();
  });

  it('opens a pasted code in development builds, with no camera', async () => {
    const home = await renderHome({ devTools: true });
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: streamRaw(IN_TWO_HOURS) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.scanner.scans).toBe(0);
  });
});

describe('useHome: the paste is development-only', () => {
  it('ignores a pasted code in a release build, even when called', async () => {
    const fakes = createFakePorts({ devTools: false });
    await fakes.ports.modeStore.load();
    const { result } = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    act(() => result.current.actions.useRaw(streamRaw(IN_TWO_HOURS)));
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe('home');
    expect(fakes.kv.entries.size).toBe(0);
  });
});

describe('Home: the scanner is never left locked', () => {
  it.each<[ScanUnavailableReason, string]>([
    ['installing', 'Getting the scanner ready… Try again in a moment.'],
    ['noPlayServices', "This phone can't open the code scanner."],
    ['failed', "The code scanner didn't open. Try again."],
  ])('scans again after "%s", and the reason clears', async (reason, text) => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'unavailable', reason }, { outcome: 'cancelled' });
    fireEvent.click(liveStreamTile());
    await screen.findByText(text);
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(2));
    expect(screen.getByText(IDLE)).toBeTruthy();
  });

  it('scans again after the operator backs out', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'cancelled' }, { outcome: 'cancelled' });
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await act(async () => undefined);
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(2));
  });

  describe('when the scanner itself breaks', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => {
      process.off('unhandledRejection', onRejection);
    });

    it.each([
      ['rejects', () => Promise.reject(new Error('task in progress'))],
      [
        'throws before returning a promise',
        () => {
          throw new Error('module gone');
        },
      ],
    ])('says so when scan() %s, and the next tap scans again', async (_, broken) => {
      const scan = vi
        .fn<CodeScannerPort['scan']>()
        .mockImplementationOnce(broken)
        .mockResolvedValue({ outcome: 'cancelled' });
      await renderHome({ scanner: { scan, prepare: () => undefined } });
      fireEvent.click(liveStreamTile());
      await screen.findByText("The code scanner didn't open. Try again.");
      fireEvent.click(liveStreamTile());
      await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
      await screen.findByText(IDLE);
      expect(rejections).toEqual([]);
    });
  });
});

describe('Home: store calls wait for a ready store (R12)', () => {
  it('ignores taps and pastes until the saved state has loaded', async () => {
    const home = renderWithPorts(<HomeScreen />);
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: streamRaw(IN_TWO_HOURS) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(0);
    expect(home.descriptor.calls).toHaveLength(0);
    expect(home.kv.entries.size).toBe(0);
    expect(home.navigation.current()).toBe('home');

    await act(() => home.ports.modeStore.load());
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it('offers Continue and Forget only once the saved state has loaded', async () => {
    const home = renderWithPorts(<HomeScreen />, {
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) },
    });
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    await act(() => home.ports.modeStore.load());
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
  });
});

describe('Home: a refused save is never silent (R19)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  /** Reads always work; a write to a key `refuses` names throws, as a locked Keystore does. */
  function refusingStore(seed: Record<string, string>, refuses: (key: string) => boolean) {
    const memory = createMemoryKeyValueStore(seed);
    const refuse = () => Promise.reject(new Error('keystore locked'));
    const kv: KeyValueStore = {
      get: memory.get,
      set: (key, value) => (refuses(key) ? refuse() : memory.set(key, value)),
      delete: (key) => (refuses(key) ? refuse() : memory.delete(key)),
    };
    return createModeStore(kv);
  }
  const every = () => true;
  const activeOnly = (key: string) => key === STORE_KEYS.active;
  const leftStream = { [STORE_KEYS.code('stream')]: savedStream(AT_1840) };

  it.each([
    ['every write', every],
    ['only the active-mode write', activeOnly],
  ])('says so and stays on Home when a scanned code hits %s refused', async (_, refuses) => {
    const home = await renderHome({ modeStore: refusingStore({}, refuses) });
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await screen.findByText(SAVE_FAILED);
    expect(home.navigation.current()).toBe('home');
    expect(rejections).toEqual([]);
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'open' } }),
    );
  });

  it('says so when a pasted code cannot be saved', async () => {
    await renderHome({ modeStore: refusingStore({}, every) });
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: streamRaw(IN_TWO_HOURS) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await screen.findByText(SAVE_FAILED);
    expect(rejections).toEqual([]);
  });

  it.each([
    ['Continue', leftStream, every],
    ['Forget', leftStream, every],
    ['Forget', { ...leftStream, [STORE_KEYS.active]: 'stream' }, activeOnly],
  ])('says so when %s cannot write, and keeps the card', async (name, seed, refuses) => {
    const home = await renderHome({ modeStore: refusingStore(seed, refuses) });
    fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByText(SAVE_FAILED);
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 1 · code valid till 18:40')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    expect(home.navigation.current()).toBe('home');
    expect(rejections).toEqual([]);
    const action = name === 'Continue' ? 'continue' : 'forget';
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action } }),
    );
  });

  it('closes the panel for good when Open cannot save', async () => {
    const fakes = createFakePorts({ modeStore: refusingStore({}, every) });
    await fakes.ports.modeStore.load();
    const { result } = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    fakes.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    act(() => result.current.actions.tapTile('scoring'));
    await waitFor(() => expect(result.current.view.panel?.kind).toBe('otherMode'));
    const panel = result.current.view.panel;
    if (panel?.kind !== 'otherMode') throw new Error('expected the other-mode panel');
    act(() => result.current.actions.openFromPanel(panel.code));
    await waitFor(() => expect(result.current.view.statusText).toBe(SAVE_FAILED));
    expect(result.current.view.panel).toBeNull();
    expect(fakes.navigation.current()).toBe('home');
  });

  it('outranks the unreadable notice', async () => {
    const garbage = STORE_KEYS.code('scoring');
    const seed = { ...leftStream, [garbage]: 'garbage' };
    // The load deletes the unreadable record; every later write is refused.
    await renderHome({ modeStore: refusingStore(seed, (key) => key !== garbage) });
    expect(screen.getByText("Couldn't read saved codes. Scan again to continue.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await screen.findByText(SAVE_FAILED);
  });

  it('outranks the expiry notice (M-c)', async () => {
    const home = await renderHome({ modeStore: refusingStore(leftStream, every) });
    const later = new Date(AT_1840.getTime() + 60_000);
    home.setNow(later);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(EXPIRED_1840);
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    const fresh = streamRaw(new Date(later.getTime() + 2 * 3600_000));
    fireEvent.change(field, { target: { value: fresh } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await screen.findByText(SAVE_FAILED);
    expect(screen.queryByText(EXPIRED_1840)).toBeNull();
    expect(rejections).toEqual([]);
  });

  it('clears on the next tap', async () => {
    const home = await renderHome({ modeStore: refusingStore({}, every) });
    home.scanner.queue(
      { outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) },
      { outcome: 'cancelled' },
    );
    fireEvent.click(liveStreamTile());
    await screen.findByText(SAVE_FAILED);
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(2));
    expect(screen.getByText(IDLE)).toBeTruthy();
  });

  it.each(['Continue', 'Forget'])('clears once %s succeeds', async (name) => {
    let locked = true;
    await renderHome({ modeStore: refusingStore(leftStream, () => locked) });
    fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByText(SAVE_FAILED);
    locked = false;
    fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByText(IDLE);
  });

  it('names the expiry, not a failed save, when Continue finds an expired code the phone will not delete (R21)', async () => {
    const home = await renderHome({ modeStore: refusingStore(leftStream, every) });
    home.setNow(new Date(AT_1840.getTime() + 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(EXPIRED_1840);
    await act(async () => undefined);
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
    expect(home.navigation.current()).toBe('home');
    expect(rejections).toEqual([]);
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'expire' } }),
    );
  });

  it('names a code that expired on air once the engine lets go, never silently (R23)', async () => {
    const seed = {
      [STORE_KEYS.code('stream')]: savedStream(AT_1840),
      [STORE_KEYS.active]: 'stream',
    };
    const fakes = createFakePorts({ kvSeed: seed });
    render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
    act(() =>
      fakes.engine.forceState({
        kind: 'publishing',
        transport: 'srt',
        sinceEpochMs: TEST_NOW.getTime(),
      }),
    );
    fakes.setNow(new Date(AT_1840.getTime() + 60_000));
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe('stream');
    act(() =>
      fakes.engine.forceState({ kind: 'ended', reason: 'hold-window-expired', durationMs: null }),
    );
    act(() => fakes.foreground.fire());
    await screen.findByText(EXPIRED_1840);
    expect(fakes.navigation.current()).toBe('home');
  });

  it("shows the reopen gate's expiry on Home when the phone will not delete the code (R21)", async () => {
    const seed = { ...leftStream, [STORE_KEYS.active]: 'stream' };
    const fakes = createFakePorts({ modeStore: refusingStore(seed, every) });
    fakes.setNow(new Date(AT_1840.getTime() + 60_000));
    render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
    await screen.findByText(EXPIRED_1840);
    await act(async () => undefined);
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    expect(fakes.navigation.current()).toBe('home');
    expect(rejections).toEqual([]);
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'expire' } }),
    );
  });
});

describe('Home: a store write that never settles (spec §5)', () => {
  afterEach(() => vi.useRealTimers());

  it('says so after 5 s and lets the operator scan again', async () => {
    vi.useFakeTimers();
    const memory = createMemoryKeyValueStore();
    const stuck: KeyValueStore = {
      get: memory.get,
      set: () => new Promise(() => undefined),
      delete: memory.delete,
    };
    const fakes = createFakePorts();
    const modeStore = createModeStore(withTimeout(stuck, { logger: fakes.ports.logger }));
    const home = renderWithPorts(<HomeScreen />, { modeStore });
    await act(() => home.ports.modeStore.load());
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await act(() => vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS));
    expect(screen.getByText(SAVE_FAILED)).toBeTruthy();
    fireEvent.click(liveStreamTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
    // The store's logger is `fakes`'; the screen's is `home`'s own.
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({
        event: 'kv.timeout',
        fields: { op: 'set', key: STORE_KEYS.code('stream'), ms: KV_TIMEOUT_MS },
      }),
    );
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'open' } }),
    );
  });
});

describe('Home: after the scan', () => {
  it('opens no second scanner while a scanned code is still being saved', async () => {
    let finishWrite: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const memory = createMemoryKeyValueStore();
    const slow: KeyValueStore = {
      ...memory,
      set: async (key, value) => {
        await written;
        await memory.set(key, value);
      },
    };
    const home = await renderHome({ modeStore: createModeStore(slow) });
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await act(async () => undefined);
    fireEvent.click(liveStreamTile());
    fireEvent.click(liveStreamTile());
    await act(async () => finishWrite());
    await waitFor(() => expect(memory.entries.get(STORE_KEYS.active)).toBe('stream'));
    expect(home.scanner.scans).toBe(1);
  });

  describe('when navigation throws', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => {
      process.off('unhandledRejection', onRejection);
    });

    it('lets nothing escape, and Home can still scan', async () => {
      const navigation = {
        current: () => 'home' as const,
        go: () => {
          throw new Error('navigator not mounted');
        },
      };
      const home = await renderHome({ navigation });
      home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
      fireEvent.click(liveStreamTile());
      await waitFor(() => expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream'));
      await act(async () => undefined);
      fireEvent.click(liveStreamTile());
      await waitFor(() => expect(home.scanner.scans).toBe(2));
      expect(rejections).toEqual([]);
    });
  });

  it('expires a code that ran out while Home sat open, instead of continuing', async () => {
    const home = await renderHome({
      kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840) },
    });
    home.setNow(new Date(AT_1840.getTime() + 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your Live Stream code expired at 18:40. Scan a new one.');
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(home.navigation.current()).toBe('home');
  });
});

describe('Home: coming back from the scanner is not a reopen (I2, R36)', () => {
  // The phone's scanner is Play services' own activity: going to it sends the
  // app to the background, and coming back is a return to the foreground,
  // which runs the reopen gate. Android delivers the scan result before that
  // return (Redmi, ~44 ms); the tests cover both orders.
  const FOREIGN = 'https://example.com/menu';

  it('keeps Home and the panel when the return lands before the result', async () => {
    const fakes = await armedHome();
    const finish = fakes.scanner.deferNext();
    fireEvent.click(liveStreamTile());
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
    await act(async () => finish({ outcome: 'scanned', raw: FOREIGN }));
    await screen.findByText("This isn't a Seazn code.");
    expect(fakes.navigation.current()).toBe('home');

    // Once the scan is over, the next return to the foreground is a reopen again.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  it('keeps Home and the panel when the result lands before the return (R36)', async () => {
    const fakes = await armedHome();
    const finish = fakes.scanner.deferNext();
    fireEvent.click(liveStreamTile());
    act(() => fakes.foreground.leave());
    await act(async () => finish({ outcome: 'scanned', raw: FOREIGN }));
    await screen.findByText("This isn't a Seazn code.");
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe('home');
    expect(screen.getByText("This isn't a Seazn code.")).toBeTruthy();

    // The swallowed return lowered the flight: the next one is a reopen.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  it('treats the next return as a reopen when the scanner never left the app', async () => {
    const fakes = await armedHome();
    fakes.scanner.queue({ outcome: 'unavailable', reason: 'noPlayServices' });
    fireEvent.click(liveStreamTile());
    await screen.findByText("This phone can't open the code scanner.");
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  /** Every write waits for `release()`: the fresh code's save is still in flight. */
  function slowStore(seed: Record<string, string>) {
    const memory = createMemoryKeyValueStore(seed);
    let release: () => void = () => undefined;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    const kv: KeyValueStore = {
      get: memory.get,
      set: async (key, value) => saving.then(() => memory.set(key, value)),
      delete: async (key) => saving.then(() => memory.delete(key)),
    };
    return { memory, modeStore: createModeStore(kv), release: () => release() };
  }

  /** Home with a saved code that runs out while the operator is away; returns the fresh code. */
  async function expiringHome() {
    const store = slowStore({ [STORE_KEYS.code('stream')]: savedStream(AT_1840) });
    const fakes = createFakePorts({ modeStore: store.modeStore });
    render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
    await screen.findByText('Continue Live Stream');
    // Counted from here: the launch decision itself is a move to Home.
    const go = vi.spyOn(fakes.navigation, 'go');
    const later = new Date(AT_1840.getTime() + 60_000);
    const freshRaw = streamRaw(new Date(later.getTime() + 2 * 3600_000), 4);
    return { ...store, fakes, go, freshRaw, later };
  }

  function expectFreshKept(home: Awaited<ReturnType<typeof expiringHome>>) {
    expect(home.fakes.navigation.current()).toBe('stream');
    // Never sent Home on the way: the only move is into the fresh code.
    expect(home.go.mock.calls.map(([route]) => route)).not.toContain('home');
    expect(home.memory.entries.get(STORE_KEYS.code('stream')) ?? '').toContain('"slot":4');
    expect(home.memory.entries.get(STORE_KEYS.active)).toBe('stream');
    const snapshot = home.fakes.ports.modeStore.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.saved.codes.stream?.slot).toBe(4);
    expect(snapshot.status === 'ready' && snapshot.notice).toBeNull();
  }

  it.each([
    ['the return lands while the fresh code is saving', 'during'],
    ['the result and the save land before the return (R36)', 'after'],
  ] as const)(
    'keeps the fresh code when the saved one expired in the scanner: %s',
    async (_, returnAt) => {
      const home = await expiringHome();
      const finish = home.fakes.scanner.deferNext();
      fireEvent.click(liveStreamTile());
      act(() => home.fakes.foreground.leave());
      home.fakes.setNow(home.later);
      await act(async () => finish({ outcome: 'scanned', raw: home.freshRaw }));
      if (returnAt === 'during') act(() => home.fakes.foreground.fire());
      await act(async () => home.release());
      await waitFor(() => expect(home.fakes.navigation.current()).toBe('stream'));
      if (returnAt === 'after') act(() => home.fakes.foreground.fire());
      await act(async () => undefined);
      expectFreshKept(home);
    },
  );

  // A paste takes the scan flight too (dev), so this return is the paste's and
  // no settle runs. A settle landing inside an open is the store's to survive:
  // modeStore.test, "never expires a code opened after the expired one was judged".
  it('keeps a pasted fresh code when the app returns mid-save', async () => {
    const home = await expiringHome();
    home.fakes.setNow(home.later);
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: home.freshRaw } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await act(async () => undefined);
    act(() => home.fakes.foreground.fire());
    await act(async () => home.release());
    await waitFor(() => expect(home.fakes.navigation.current()).toBe('stream'));
    expect(home.memory.entries.get(STORE_KEYS.code('stream')) ?? '').toContain('"slot":4');
    const snapshot = home.fakes.ports.modeStore.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.saved.codes.stream?.slot).toBe(4);
    expect(snapshot.status === 'ready' && snapshot.notice).toBeNull();
  });
});

describe('Home: Android Back closes what is open (R31)', () => {
  const languageToggle = () => screen.getByRole('button', { name: /Language/ });
  function press(home: { back: { press(): boolean } }): boolean {
    let handled = false;
    act(() => {
      handled = home.back.press();
    });
    return handled;
  }

  it('closes an open code panel and stays in the app', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://example.com/menu' });
    fireEvent.click(liveStreamTile());
    await screen.findByText("This isn't a Seazn code.");
    // The panel's Back handler is an effect: it may not be up when findBy resolves (carry 17).
    await waitFor(() => expect(press(home)).toBe(true));
    expect(screen.queryByText("This isn't a Seazn code.")).toBeNull();
    expect(home.navigation.current()).toBe('home');
  });

  it('closes an open language list (M-f)', async () => {
    const home = await renderHome();
    fireEvent.click(languageToggle());
    expect(screen.getByRole('button', { name: 'Español' })).toBeTruthy();
    expect(press(home)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Español' })).toBeNull();
    expect(languageToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves Back to the phone when nothing is open', async () => {
    const home = await renderHome();
    expect(press(home)).toBe(false);
  });

  it('closes the panel, then the list under it, then lets Back go', async () => {
    const home = await renderHome();
    fireEvent.click(languageToggle());
    home.scanner.queue({ outcome: 'scanned', raw: 'https://example.com/menu' });
    fireEvent.click(liveStreamTile());
    await screen.findByText("This isn't a Seazn code.");
    await waitFor(() => expect(press(home)).toBe(true));
    expect(screen.queryByText("This isn't a Seazn code.")).toBeNull();
    expect(screen.getByRole('button', { name: 'Español' })).toBeTruthy();
    expect(press(home)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Español' })).toBeNull();
    expect(press(home)).toBe(false);
  });
});

describe('Scan another (D24)', () => {
  it('scans from the Live Stream tile once Home is ready, and only once', async () => {
    // Asked before Home mounts, on a store still loading: the request waits for it (R12).
    const home = createFakePorts();
    home.ports.homeIntent.requestScan();
    render(<HomeScreen />, { wrapper: wrapperFor(home) });
    expect(home.scanner.scans).toBe(0);
    await act(() => home.ports.modeStore.load());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await waitFor(() => expect(home.ports.scanFlight.active()).toBe(false));
    // M19: a fresh Home over the same ports, as the next visit would mount it.
    cleanup();
    render(<HomeScreen />, { wrapper: wrapperFor(home) });
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
  });

  it('does nothing when nobody asked', async () => {
    const home = await renderHome();
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(0);
  });

  it('opens a stream code scanned on the hand-off, as a tap on the tile would', async () => {
    const home = renderWithPorts(<HomeScreen />);
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    home.ports.homeIntent.requestScan();
    await act(() => home.ports.modeStore.load());
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });
});

describe('Home: the code panel is modal to TalkBack too', () => {
  it('hides Home behind the panel from the accessibility tree, and restores it on close', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://example.com/menu' });
    fireEvent.click(liveStreamTile());
    await screen.findByText("This isn't a Seazn code.");
    const behind = home.container.querySelector('[aria-hidden="true"]');
    expect(behind?.textContent).toContain('Film a match to YouTube.');
    expect(behind?.textContent).not.toContain("This isn't a Seazn code.");
    expect(screen.queryByRole('button', { name: /Live Stream/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Language/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(liveStreamTile()).toBeTruthy());
    expect(home.container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Home: checking a stream code with the server (spec §1)', () => {
  afterEach(() => vi.useRealTimers());

  const scanStream = async (home: Awaited<ReturnType<typeof renderHome>>) => {
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
  };
  /** The tile behind a panel is hidden from the accessibility tree (M8). */
  const hiddenTile = () => screen.getByRole('button', { name: /Live Stream/, hidden: true });

  it('says Checking code… while it asks, then saves the descriptor and opens', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    expect(home.navigation.current()).toBe('home');
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    const saved = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('stream')) ?? '');
    expect(saved?.descriptor?.label).toBe('Seazn XI v Fake CC');
    expect(home.descriptor.calls).toEqual([
      { sid: '5d9c1d0e-0000-4000-8000-000000000001', token: 'fake-token-00000000000000000000' },
    ]);
  });

  it('opens no second scanner while a code is being checked', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    fireEvent.click(hiddenTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    expect(screen.getByText('Checking code…')).toBeTruthy();
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it('keeps Checking code… up against Back and the dim', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    // The panel's Back handler registers in an effect after the text paints.
    await act(async () => undefined);
    let handled = false;
    act(() => {
      handled = home.back.press();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handled).toBe(true);
    expect(screen.getByText('Checking code…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it('is not a reopen when the app returns to the foreground mid-check (I2)', async () => {
    const fakes = createFakePorts();
    render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    act(() => fakes.engine.forceState({ kind: 'armed' }));
    const release = fakes.descriptor.hold();
    fakes.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await screen.findByText('Checking code…');
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(fakes.navigation.current()).toBe('home');
    expect(screen.getByText('Checking code…')).toBeTruthy();
    release();
    await waitFor(() => expect(fakes.navigation.current()).toBe('stream'));
  });

  it.each([
    [{ kind: 'invalid' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [{ kind: 'not-found' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [
      { kind: 'ended', endReason: 'stopped' },
      'Stream ended',
      'This stream was ended by the organiser.',
    ],
    [
      { kind: 'ended', endReason: 'unknown' },
      'Stream ended',
      'This stream was ended by the organiser.',
    ],
    [
      { kind: 'ended', endReason: 'no-inbound-timeout' },
      'Code timed out',
      'This code timed out — ask the organiser for a new one.',
    ],
    [
      { kind: 'ended', endReason: 'max-duration' },
      'Code timed out',
      'This code timed out — ask the organiser for a new one.',
    ],
    [{ kind: 'offline' }, 'No connection', "Can't check this code — no connection. Try again."],
    [{ kind: 'rate-limited', retryAfterS: 7 }, 'Server busy', 'Busy — trying again in 7s'],
  ] as const)('explains %j and saves nothing', async (error, title, body) => {
    const home = await renderHome();
    home.descriptor.answer(err(error));
    await scanStream(home);
    await screen.findByText(title);
    expect(screen.getByText(body)).toBeTruthy();
    expect(home.navigation.current()).toBe('home');
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('scans again from a refusal, with the same tile', async () => {
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'invalid' }));
    await scanStream(home);
    await screen.findByText('Not valid for streaming');
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS, 3) });
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.scanner.scans).toBe(2);
    expect(home.descriptor.calls).toHaveLength(2);
  });

  it('tries the same code again from the offline panel, without the scanner', async () => {
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'offline' }));
    await scanStream(home);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.descriptor.calls).toHaveLength(2);
    expect(home.scanner.scans).toBe(1);
  });

  it('never retries by itself when there was no connection', async () => {
    vi.useFakeTimers();
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'offline' }));
    await scanStream(home);
    await act(async () => undefined);
    expect(screen.getByText('No connection')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(130_000));
    expect(home.descriptor.calls).toHaveLength(1);
    expect(home.navigation.current()).toBe('home');
  });

  it('retries once by itself when the server says it is busy (D5)', async () => {
    vi.useFakeTimers();
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'rate-limited', retryAfterS: 7 }));
    await scanStream(home);
    await act(async () => undefined);
    expect(screen.getByText('Busy — trying again in 7s')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6999));
    expect(home.descriptor.calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(async () => undefined);
    expect(home.descriptor.calls).toHaveLength(2);
    expect(home.navigation.current()).toBe('stream');
  });

  it('retries a busy answer only once, even while the retry is still being checked', async () => {
    vi.useFakeTimers();
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'rate-limited', retryAfterS: 7 }));
    await scanStream(home);
    await act(async () => undefined);
    const release = home.descriptor.hold();
    await act(() => vi.advanceTimersByTimeAsync(7000));
    expect(screen.getByText('Checking code…')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(7000));
    expect(home.descriptor.calls).toHaveLength(2);
    release();
    await act(async () => undefined);
    expect(home.navigation.current()).toBe('stream');
  });

  it('drops the busy retry once the operator scans again instead', async () => {
    vi.useFakeTimers();
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'rate-limited', retryAfterS: 7 }));
    await scanStream(home);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(home.descriptor.calls).toHaveLength(1);
    expect(home.navigation.current()).toBe('home');
  });

  type Retry = 'Try again' | 'the busy retry';
  const RETRIES: readonly Retry[] = ['Try again', 'the busy retry'];

  /** Scans a stream code, then refuses it and its retry (I2): the retry's flight must end. */
  async function refusedTwice(
    fakes: Pick<Awaited<ReturnType<typeof renderHome>>, 'descriptor' | 'scanner'>,
    retry: Retry,
  ) {
    const busy = retry === 'the busy retry';
    const refusal = busy
      ? ({ kind: 'rate-limited', retryAfterS: 7 } as const)
      : ({ kind: 'offline' } as const);
    fakes.descriptor.answer(err(refusal), err(refusal));
    fakes.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await act(async () => undefined);
    if (busy) await act(() => vi.advanceTimersByTimeAsync(7000));
    else fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => undefined);
    expect(fakes.descriptor.calls).toHaveLength(2);
    expect(screen.getByText(busy ? 'Server busy' : 'No connection')).toBeTruthy();
  }

  it.each(RETRIES)(
    'opens the scanner from a tile tap after %s is refused again (I2)',
    async (retry) => {
      vi.useFakeTimers();
      const home = await renderHome();
      await refusedTwice(home, retry);
      home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS, 3) });
      fireEvent.click(hiddenTile());
      await act(async () => undefined);
      expect(home.scanner.scans).toBe(2);
      expect(home.descriptor.calls).toHaveLength(3);
      expect(home.navigation.current()).toBe('stream');
    },
  );

  it.each(RETRIES)(
    'still reopens on the next return after %s is refused again (I2)',
    async (retry) => {
      const fakes = await armedHome();
      vi.useFakeTimers();
      await refusedTwice(fakes, retry);
      expect(fakes.navigation.current()).toBe('home');
      act(() => fakes.foreground.leave());
      act(() => fakes.foreground.fire());
      await act(async () => undefined);
      expect(fakes.navigation.current()).toBe('stream');
    },
  );

  it('shows the expired panel, and asks nothing, for a Try again the minute the code ran out', async () => {
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'offline' }));
    home.scanner.queue({
      outcome: 'scanned',
      raw: streamRaw(new Date(TEST_NOW.getTime() + 60_000)),
    });
    fireEvent.click(liveStreamTile());
    await screen.findByText('No connection');
    home.setNow(new Date(TEST_NOW.getTime() + 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('This code expired at 14:01. Ask the desk for a new one.');
    expect(home.descriptor.calls).toHaveLength(1);
    expect(screen.queryByText('Checking code…')).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);

    // The retry's flight ended: the panel's own Scan again opens the scanner.
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
  });

  it("gives the code's own expiry, not the time of the Try again, minutes after it ran out", async () => {
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'offline' }));
    home.scanner.queue({
      outcome: 'scanned',
      raw: streamRaw(new Date(TEST_NOW.getTime() + 60_000)),
    });
    fireEvent.click(liveStreamTile());
    await screen.findByText('No connection');
    home.setNow(new Date(TEST_NOW.getTime() + 5 * 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('This code expired at 14:01. Ask the desk for a new one.');
    expect(screen.queryByText(/14:05/)).toBeNull();
    expect(home.descriptor.calls).toHaveLength(1);
  });

  it('checks a pasted code once, however many times Use is pressed (dev)', async () => {
    const home = await renderHome({ devTools: true });
    const release = home.descriptor.hold();
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: streamRaw(IN_TWO_HOURS) } });
    const use = screen.getByRole('button', { name: 'Use pasted code' });
    fireEvent.click(use);
    fireEvent.click(use);
    await screen.findByText('Checking code…');
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.descriptor.calls).toHaveLength(1);
    expect(home.ports.scanFlight.active()).toBe(false);
  });

  it('opens no scanner from a tile while a pasted code is being checked (dev)', async () => {
    const home = await renderHome({ devTools: true });
    const release = home.descriptor.hold();
    const field = screen.getByPlaceholderText('Paste a code (development only)');
    fireEvent.change(field, { target: { value: streamRaw(IN_TWO_HOURS) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted code' }));
    await screen.findByText('Checking code…');
    fireEvent.click(hiddenTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(0);
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('module missing'))],
    [
      'throws before it answers',
      () => {
        throw new Error('module missing');
      },
    ],
  ])('calls a descriptor port that %s "no connection" (missing module)', async (_label, fetch) => {
    const throwing = { fetch };
    const home = await renderHome({ descriptor: throwing as never });
    await scanStream(home);
    await screen.findByText('No connection');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({
        event: 'descriptor.error',
        fields: { kind: 'offline', status: 0, problem: 'port-threw' },
      }),
    );
  });

  it('says no connection after 8 s when the server never answers, and scans again (Review Focus 1)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    const descriptor = createFetchDescriptorPort({
      origin: 'https://stg.seazn.club',
      fetch: () => new Promise(() => undefined),
      logger: fakes.ports.logger,
    });
    const home = await renderHome({ descriptor });
    await scanStream(home);
    await act(() => vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS));
    expect(screen.getByText('No connection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
  });

  it('says so, and keeps no code, when the phone will not save a checked code', async () => {
    const memory = createMemoryKeyValueStore();
    const kv: KeyValueStore = {
      ...memory,
      set: () => Promise.reject(new Error('keystore locked')),
    };
    const home = await renderHome({ modeStore: createModeStore(kv) });
    await scanStream(home);
    await screen.findByText(SAVE_FAILED);
    expect(home.descriptor.calls).toHaveLength(1);
    expect(screen.queryByText('Checking code…')).toBeNull();
    expect(home.navigation.current()).toBe('home');
    expect(memory.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('never asks the server about a scoring code', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://stg.seazn.club/score/abc123' });
    fireEvent.click(liveStreamTile());
    await screen.findByText('This is a Remote Scoring code');
    expect(home.descriptor.calls).toHaveLength(0);
  });

  it.each([
    ['en', 'Live Stream', 'Checking code…', 'No connection', 'Try again'],
    ['es', 'Emisión en directo', 'Comprobando el código…', 'Sin conexión', 'Reintentar'],
    ['fr', 'Diffusion en direct', 'Vérification du code…', 'Pas de connexion', 'Réessayer'],
    ['nl', 'Livestream', 'Code controleren…', 'Geen verbinding', 'Opnieuw proberen'],
  ])('speaks %s while checking and when offline', async (lang, tile, checking, offline, retry) => {
    const home = await renderHome({ deviceLanguages: [lang] });
    home.descriptor.answer(err({ kind: 'offline' }));
    const release = home.descriptor.hold();
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(tile) }));
    await screen.findByText(checking);
    release();
    await screen.findByText(offline);
    expect(screen.getByRole('button', { name: retry })).toBeTruthy();
  });
});

describe('useHome: every open goes through the check', () => {
  const streamCode = {
    mode: 'stream',
    raw: 'r',
    sid: 'fake-sid',
    slot: 0,
    token: 'fake-token',
    expiresAt: IN_TWO_HOURS,
  } as const;

  async function homeHook(options?: Parameters<typeof createFakePorts>[0]) {
    const fakes = createFakePorts(options);
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    return { ...fakes, hook };
  }

  it('checks a stream code opened from the panel, not only a scanned one', async () => {
    const home = await homeHook();
    act(() => home.hook.result.current.actions.openFromPanel(streamCode));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.descriptor.calls).toEqual([{ sid: 'fake-sid', token: 'fake-token' }]);
  });

  const scoring = { mode: 'scoring', raw: 'https://stg.seazn.club/score/t', token: 't' } as const;

  it('saves a scoring code opened from the panel without asking the server', async () => {
    const home = await homeHook();
    home.scanner.queue({ outcome: 'scanned', raw: scoring.raw });
    act(() => home.hook.result.current.actions.tapTile('stream'));
    await waitFor(() => expect(home.hook.result.current.view.panel).not.toBeNull());
    act(() => home.hook.result.current.actions.openFromPanel(scoring));
    await waitFor(() => expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(true));
    expect(home.hook.result.current.view.panel).toBeNull();
    expect(home.descriptor.calls).toHaveLength(0);
    const saved = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('scoring')) ?? '');
    expect(saved?.descriptor).toBeNull();
  });

  it('saves nothing for a code opened from the panel before the store has loaded (R12)', async () => {
    const fakes = createFakePorts();
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    act(() => hook.result.current.actions.openFromPanel(scoring));
    await act(async () => undefined);
    await act(() => fakes.ports.modeStore.load());
    await act(async () => undefined);
    expect(fakes.kv.entries.size).toBe(0);
    expect(fakes.navigation.current()).toBe('home');
  });

  it('asks nothing when Try again has no refused code to try', async () => {
    const home = await homeHook();
    act(() => home.hook.result.current.actions.retryCheck());
    await act(async () => undefined);
    expect(home.descriptor.calls).toHaveLength(0);
    expect(home.ports.scanFlight.active()).toBe(false);
  });

  it('asks again once for two Try agains before the first is answered', async () => {
    const home = await homeHook();
    home.descriptor.answer(err({ kind: 'offline' }));
    act(() => home.hook.result.current.actions.openFromPanel(streamCode));
    await waitFor(() => expect(home.hook.result.current.view.panel?.kind).toBe('descriptorError'));
    const release = home.descriptor.hold();
    const { retryCheck } = home.hook.result.current.actions;
    act(() => {
      retryCheck();
      retryCheck();
    });
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.descriptor.calls).toHaveLength(2);
  });
});
