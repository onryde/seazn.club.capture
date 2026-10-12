import { act, fireEvent, screen } from '@testing-library/react';
import { Profiler, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { PanelUnpairReason } from '@/hooks/useHome';
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

/**
 * Re-review round 1: a render loop inside `act` never returns, so it would hang
 * the file rather than fail it. Every mount here (Home, or the routed app
 * around it) is under a commit bound, so a loop fails in a bounded time. The
 * most a healthy test here commits is 17 (measured 2026-10-05); the bound is
 * far above it.
 */
const LOOP_BOUND = 200;
function underBound(ui: ReactNode): ReactElement {
  let commits = 0;
  const counted = () => {
    commits += 1;
    if (commits > LOOP_BOUND) throw new Error(`committed ${commits} times: a render loop`);
  };
  return (
    <Profiler id="bounded" onRender={counted}>
      {ui}
    </Profiler>
  );
}
const launch = (options: Parameters<typeof launchApp>[0]) =>
  launchApp({ around: underBound, ...options });

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
const PANEL: Readonly<Record<PanelUnpairReason, readonly [title: string, body: string]>> = {
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
const showsPanel = (reason: PanelUnpairReason) => {
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
  const app = await launch({
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

  // R6 of the D3 findings design: the operator's own Forget, from the notification, needs no explanation.
  it('shows no panel and no Continue card after the notification’s Forget, the code forgotten', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.notificationForget());
    await flush();
    expect(app.engine.getSnapshot().unpaired).toMatchObject({ reason: 'forgotten', slot: 1 });
    expect(app.nav.current()).toBe('home');
    noPanel();
    expect(hasSaved(app)).toBe(false);
    expect(screen.queryByText('Continue Live Stream')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    // Native keeps naming the unpair while Idle: later reports bring no panel either.
    await flush(3_000);
    noPanel();
  });

  // Review C5 m-7: `replaced` ends a held broadcast too (native's answer table, Pairings.kt).
  it('names why when the code is paired elsewhere while on air', async () => {
    const app = await pairedOnStream();
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush(3_000);
    expect(app.engine.getSnapshot().state.kind).toBe('publishing');
    expect(app.nav.current()).toBe('stream');
    act(() => app.engine.hear({ word: 'replaced' }));
    await flush();
    expect(app.engine.getSnapshot()).toMatchObject({
      state: { kind: 'idle' },
      unpaired: { reason: 'replaced' },
    });
    expect(app.nav.current()).toBe('home');
    showsPanel('replaced');
    expect(hasSaved(app)).toBe(false);
    expect(screen.queryByText(/^Paired ·/)).toBeNull();
  });

  // Task 24's resume at a cold start, refused by the phone's permissions.
  it('names the permissions when a cold start’s re-pair is refused', async () => {
    const app = await launch({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('refuse'),
    });
    await flush();
    expect(intentKinds(app)).toEqual(['pair']);
    expect(app.nav.current()).toBe('home');
    showsPanel('permissions');
    expect(hasSaved(app)).toBe(false);
  });

  // Fake parity (re-review round 1): the same code refused twice names it twice, because
  // each pair passes through Pairing, which names no unpair.
  it('names the permissions again when the same code is refused again', async () => {
    const app = await launch({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('refuse'),
    });
    await flush();
    showsPanel('permissions');
    close();
    await flush();
    noPanel();
    await scanFromHome(app, code.raw);
    await flush(3_000);
    expect(intentKinds(app)).toEqual(['pair', 'pair']);
    expect(app.nav.current()).toBe('home');
    showsPanel('permissions');
  });

  // m-11's memory clears on any pairing, not only on Paired: a held dialog refused twice says so twice.
  it('names the permissions again after a held dialog is refused twice', async () => {
    const app = await launch({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('hold'),
    });
    await flush();
    expect(app.engine.getSnapshot().state.kind).toBe('pairing');
    act(() => app.engine.setPermissions('refuse'));
    await flush();
    showsPanel('permissions');
    close();
    await flush();
    act(() => app.engine.setPermissions('hold'));
    await scanFromHome(app, code.raw);
    await flush(3_000);
    expect(app.engine.getSnapshot().state.kind).toBe('pairing');
    act(() => app.engine.setPermissions('refuse'));
    await flush();
    expect(app.nav.current()).toBe('home');
    showsPanel('permissions');
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

  // Re-review round 1: a memory that never matches re-sets the panel on every commit, a loop
  // inside `act`. Counted commits make that a failure in a bounded time, never a hang.
  it('names an unpair in a bounded number of commits', async () => {
    let commits = 0;
    const counted = () => {
      commits += 1;
      if (commits > 25) throw new Error(`Home committed ${commits} times: a render loop`);
    };
    const view = renderWithPorts(
      <Profiler id="home" onRender={counted}>
        <HomeScreen />
      </Profiler>,
    );
    await act(() => view.ports.modeStore.load());
    act(() => pairCode(view.engine, code));
    const before = commits;
    act(() => view.engine.hear({ word: 'replaced' }));
    await flush();
    showsPanel('replaced');
    expect(commits - before).toBe(2);
  });

  // Review C5 m-11: Home mounts again (the crash screen's Try again remounts the tree, Home
  // included): a panel already closed stays closed, and the next unpair still says so.
  it('keeps a closed panel closed when Home mounts again', async () => {
    const view = renderWithPorts(underBound(<HomeScreen />));
    await act(() => view.ports.modeStore.load());
    act(() => pairCode(view.engine, code));
    act(() => view.engine.hear({ word: 'replaced' }));
    await flush();
    showsPanel('replaced');
    close();
    await flush();
    noPanel();
    view.rerender(underBound(<HomeScreen key="mounted-again" />));
    await flush();
    expect(view.engine.getSnapshot().unpaired).toMatchObject({ reason: 'replaced' });
    noPanel();
    act(() => pairCode(view.engine, code));
    act(() => view.engine.hear({ word: 'taken' }));
    await flush();
    showsPanel('taken');
  });

  // m-11's memory listens for the next pair, then lets go: no listener is left behind.
  it('leaves no engine listener behind once the next pair clears the unpair', async () => {
    const view = renderWithPorts(underBound(<HomeScreen />));
    await act(() => view.ports.modeStore.load());
    const subscribe = view.engine.subscribe;
    let open = 0;
    view.engine.subscribe = (listener) => {
      open += 1;
      const off = subscribe(listener);
      return () => {
        open -= 1;
        off();
      };
    };
    act(() => pairCode(view.engine, code));
    await flush();
    const before = open;
    act(() => view.engine.hear({ word: 'replaced' }));
    await flush();
    showsPanel('replaced');
    expect(open).toBe(before + 1);
    act(() => pairCode(view.engine, code));
    await flush();
    expect(open).toBe(before);
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
    // The fake's scene names its own pairing (slot 1), reached through Pairing as native does.
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
    const home = renderWithPorts(underBound(<HomeScreen />), { deviceLanguages: ['fr'] });
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

  // Review C5 I-4: backed out of /stream mid-pair, then the pair fails. Never "Paired".
  it('says Pairing, never Paired, for a pair that then fails', async () => {
    const app = await launch({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('hold'),
    });
    await flush();
    expect(app.engine.getSnapshot().state.kind).toBe('pairing');
    home();
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Pairing this phone…')).toBeTruthy();
    expect(screen.queryByText(/Paired/)).toBeNull();
    act(() => app.engine.setPermissions('refuse'));
    await flush();
    showsPanel('permissions');
    expect(screen.queryByText(/Paired/)).toBeNull();
    expect(screen.queryByText('Pairing this phone…')).toBeNull();
  });

  // The same pair granted: the card moves on to Paired once native has.
  it('says Paired once a pairing it showed is granted', async () => {
    const app = await launch({
      kvSeed: inStream(),
      prepare: (fakes) => fakes.engine.setPermissions('hold'),
    });
    await flush();
    home();
    await flush();
    expect(screen.getByText('Pairing this phone…')).toBeTruthy();
    act(() => app.engine.setPermissions('grant'));
    await flush();
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    expect(screen.getByText('Paired · Seazn XI v Fake CC')).toBeTruthy();
    expect(screen.queryByText('Pairing this phone…')).toBeNull();
  });

  // CD39 (A1): a stable code has no `exp`; the card says its slot alone, never "valid till .".
  it('says the slot alone for a saved code with no expiry', async () => {
    const stable = savedStreamCode({ expiresAt: null });
    await launch({ kvSeed: { [STORE_KEYS.code('stream')]: encodeSavedCode(stable) } });
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.getByText('Slot 1')).toBeTruthy();
    expect(screen.queryByText(/valid till/)).toBeNull();
  });
});
