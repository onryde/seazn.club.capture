import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { UnpairReason } from '@/domain/session/Pairing';
import { STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw } from '../../../test/fixtures/wire';
import { pairCode } from '../../../test/pairCode';
import { renderWithPorts } from '../../../test/renderWithPorts';
import {
  flush,
  intentKinds,
  launchApp,
  scanFromHome,
  type LaunchedApp,
} from '../../../test/routedApp';

const code = savedStreamCode();
/** Another camera position of the same match: another code to the identity rules (C7). */
const other = savedStreamCode({
  raw: captureRaw({ slot: 2, tok: 'tok-other-000000000000' }),
  slot: 2,
});
const inStream = (saved: SavedCode = code) => ({
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
});

/** Amendment §2's panels, by reason, written out from the copy table. */
const PANEL: Readonly<Record<UnpairReason, readonly [title: string, body: string]>> = {
  'code-ended': ['Code ended', 'This code has ended. Scan the new one.'],
  replaced: [
    'Paired on another phone',
    'This code is now paired on another phone. Scan it again to use this one.',
  ],
  taken: ['Already live', 'This camera is live on another phone.'],
  permissions: [
    'Camera and microphone needed',
    'Allow the camera and microphone in Android Settings, then try again',
  ],
};
const showsPanel = (reason: UnpairReason) => {
  const [title, body] = PANEL[reason];
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText(body)).toBeTruthy();
};
const titles = Object.values(PANEL).map(([title]) => title);
const noPanel = () => {
  for (const title of titles) expect(screen.queryByText(title)).toBeNull();
};
const close = () => fireEvent.click(screen.getByRole('button', { name: 'Close' }));
const hasSaved = (app: LaunchedApp) => app.kv.entries.has(STORE_KEYS.code('stream'));

/** A saved code, paired by native, on /stream: as a scan leaves it. */
async function pairedOnStream(saved: SavedCode = code): Promise<LaunchedApp> {
  const app = await launchApp({
    kvSeed: inStream(saved),
    prepare: (fakes) => pairCode(fakes.engine, saved),
  });
  expect(app.nav.current()).toBe('stream');
  expect(app.engine.getSnapshot().state.kind).toBe('paired');
  return app;
}

/**
 * Amendment §2, Unpaired without asking: native leaves the pairing, the app
 * forgets the code and goes Home (Task 24), and Home says why, once per unpair.
 */
describe('Home after an unpair the operator did not ask for', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['code-ended', 'replaced', 'taken'] as const)(
    'names why for %s, with no Continue card and the code forgotten',
    async (word) => {
      const app = await pairedOnStream();
      act(() => app.engine.hear({ word }));
      await flush();
      expect(app.nav.current()).toBe('home');
      showsPanel(word);
      expect(hasSaved(app)).toBe(false);
      expect(screen.queryByText('Continue Live Stream')).toBeNull();
      expect(screen.queryByText(/^Paired ·/)).toBeNull();
    },
  );

  // Task 24's resume at a cold start, refused by the phone's permissions.
  it('names the permissions when a cold start’s re-pair is refused', async () => {
    const app = await launchApp({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('refuse'),
    });
    await flush();
    expect(intentKinds(app)).toEqual(['pair']);
    expect(app.nav.current()).toBe('home');
    showsPanel('permissions');
    expect(hasSaved(app)).toBe(false);
  });

  it('scans again from the Live Stream tile', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    const before = app.scanner.scans;
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await flush();
    expect(app.scanner.scans).toBe(before + 1);
    noPanel();
  });

  it('closes, and the same unpair in later snapshots does not bring it back', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    showsPanel('replaced');
    close();
    await flush();
    noPanel();
    // Native keeps naming the unpair while Idle: three 1 Hz reports, and a readiness change.
    await flush(3_000);
    act(() => app.engine.setReady({ network: false }));
    await flush();
    expect(app.engine.getSnapshot().unpaired).toMatchObject({ reason: 'replaced', slot: 1 });
    noPanel();
  });

  // PV31: the same code, unpaired twice.
  it('shows the panel again when the same code is paired again and unpaired again', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    close();
    await scanFromHome(app, code.raw);
    await flush(3_000);
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    showsPanel('replaced');
  });

  // PV31, with Home in view throughout: native's next pair clears the unpair it named.
  it('shows the panel again for the same code re-paired while Home stays up', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    close();
    act(() => pairCode(app.engine, code));
    await flush();
    expect(app.engine.getSnapshot().unpaired).toBeNull();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    showsPanel('replaced');
  });

  // A second unpair for the same reason, naming another code, straight after the first.
  it('shows the panel again for the same reason on another code', async () => {
    const app = await pairedOnStream(other);
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    close();
    // The fake's scene names its own pairing (slot 1), so the key moves without passing null.
    act(() => app.engine.scene('unpaired-replaced'));
    await flush();
    expect(app.engine.getSnapshot().unpaired).toMatchObject({ reason: 'replaced', slot: 1 });
    showsPanel('replaced');
  });

  it('shows no panel for the operator’s own Forget', async () => {
    const app = await pairedOnStream();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await flush();
    expect(app.engine.getSnapshot()).toMatchObject({ state: { kind: 'idle' }, unpaired: null });
    expect(hasSaved(app)).toBe(false);
    noPanel();
  });

  // A scan in flight keeps "Checking code…": the unpair waits for the next change.
  it('keeps Checking code… while a scan is checked', async () => {
    const app = await pairedOnStream();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flush();
    const release = app.code.hold();
    await scanFromHome(app, other.raw);
    expect(screen.getByText('Checking code…')).toBeTruthy();
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    expect(screen.getByText('Checking code…')).toBeTruthy();
    noPanel();
    act(() => release());
    await flush(3_000);
    expect(app.nav.current()).toBe('stream');
  });
});

/** Question 4: the replaced panel in French, from the copy table. */
describe('Home’s unpaired panel in another language', () => {
  it('names a replaced code in French', async () => {
    const home = renderWithPorts(<HomeScreen />, { deviceLanguages: ['fr'] });
    await act(() => home.ports.modeStore.load());
    act(() => pairCode(home.engine, code));
    act(() => home.engine.hear({ word: 'replaced' }));
    expect(screen.getByText('Associé à un autre téléphone')).toBeTruthy();
    expect(
      screen.getByText(
        'Ce code est associé à un autre téléphone. Scannez-le à nouveau pour utiliser celui-ci.',
      ),
    ).toBeTruthy();
  });
});

/** Amendment §2, Home: the Continue card says what the engine holds for the saved code. */
describe('Home’s Continue card', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const home = () => fireEvent.click(screen.getByRole('button', { name: 'Home' }));

  it('says a paired code is paired and waits for Go live', async () => {
    await pairedOnStream();
    home();
    await flush();
    expect(screen.getByText('Paired · Seazn XI v Fake CC')).toBeTruthy();
    expect(screen.getByText('Waiting for Go live')).toBeTruthy();
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
  });

  // CD39 (A1): a stable code has no `exp`; the card says its slot alone, never "valid till .".
  it('says the slot alone for a saved code with no expiry', async () => {
    const stable = savedStreamCode({ expiresAt: null });
    await launchApp({ kvSeed: { [STORE_KEYS.code('stream')]: encodeSavedCode(stable) } });
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 1')).toBeTruthy();
    expect(screen.queryByText(/valid till/)).toBeNull();
  });
});
