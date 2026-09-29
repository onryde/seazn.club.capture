import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { useHome } from '@/hooks/useHome';
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

  describe('when a storage write fails', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => {
      process.off('unhandledRejection', onRejection);
    });

    /** Reads work; every write throws, as a locked Keystore does. */
    function lockedStore(seed: Record<string, string> = {}): KeyValueStore {
      const memory = createMemoryKeyValueStore(seed);
      const locked = () => Promise.reject(new Error('keystore locked'));
      return { get: memory.get, set: locked, delete: locked };
    }

    it('stays on Home rather than opening a code it could not save', async () => {
      const home = await renderHome({ modeStore: createModeStore(lockedStore()) });
      home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
      fireEvent.click(liveStreamTile());
      await waitFor(() => expect(home.scanner.scans).toBe(1));
      await act(async () => undefined);
      expect(home.navigation.current()).toBe('home');
      expect(rejections).toEqual([]);
    });

    it.each(['Continue', 'Forget'])('rejects nothing when %s cannot write', async (name) => {
      const seed = { [STORE_KEYS.code('stream')]: savedStream(AT_1840) };
      const home = await renderHome({ modeStore: createModeStore(lockedStore(seed)) });
      fireEvent.click(screen.getByRole('button', { name }));
      await act(async () => undefined);
      expect(home.navigation.current()).toBe('home');
      expect(screen.getByText('Continue Live Stream')).toBeTruthy();
      expect(rejections).toEqual([]);
    });
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
