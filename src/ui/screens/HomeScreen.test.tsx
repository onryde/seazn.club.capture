import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { useHome } from '@/hooks/useHome';
import { useReopenGate } from '@/hooks/useReopenGate';
import type { CodeScannerPort, ScanUnavailableReason } from '@/scanner/CodeScannerPort';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

const IN_TWO_HOURS = new Date(TEST_NOW.getTime() + 2 * 3600_000);
// 17:40Z is 18:40 in the fake phone's Europe/London zone (BST).
const AT_1840 = new Date('2026-10-03T17:40:00Z');

/** Made-up credentials. */
function streamRaw(exp: Date, slot = 1): string {
  return JSON.stringify({
    v: 1,
    sid: '5d9c1d0e-0000-4000-8000-000000000001',
    slot,
    cred: {
      srt: {
        url: 'srt://ingest.example:9001',
        streamId: 'fake',
        passphrase: 'fake-pass-0000',
        latencyMs: 2000,
      },
      rtmps: { url: 'rtmps://ingest.example/live', streamKey: 'fake-key' },
    },
    preferred: 'srt',
    exp: Math.floor(exp.getTime() / 1000),
  });
}

/** A stream code saved by an earlier scan, as the store writes it. */
function savedStream(expiresAt: Date): string {
  const raw = streamRaw(expiresAt);
  return encodeSavedCode({
    mode: 'stream',
    raw,
    slot: 1,
    savedAt: TEST_NOW,
    expiresAt,
    venueTz: null,
  });
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
const IDLE = 'Tap a mode, then scan its code.';

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
      home.ports.modeStore.expire(['stream'], { mode: 'stream', expiredAt: AT_1840 }),
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
    await act(() => home.ports.modeStore.expire([], { mode: 'stream', expiredAt: AT_1840 }));
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
  const SAVE_FAILED = "Couldn't save on this phone. Try again.";
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
    act(() => fakes.engine.forceState({ kind: 'ended', reason: 'hold-window-expired' }));
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

  async function armedHome() {
    const fakes = createFakePorts();
    render(<GateThenHome />, { wrapper: wrapperFor(fakes) });
    await waitFor(() => expect(fakes.splash.hides).toBe(1));
    act(() => fakes.engine.forceState({ kind: 'armed' }));
    return fakes;
  }

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

  // No scan, so no flight: the settle runs, and its expiry lands inside the
  // open. Only the store's check that the code is still the one judged keeps it.
  it('keeps a pasted fresh code when a reopen expires the old one mid-save', async () => {
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
    expect(press(home)).toBe(true);
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
    expect(press(home)).toBe(true);
    expect(screen.queryByText("This isn't a Seazn code.")).toBeNull();
    expect(screen.getByRole('button', { name: 'Español' })).toBeTruthy();
    expect(press(home)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Español' })).toBeNull();
    expect(press(home)).toBe(false);
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
