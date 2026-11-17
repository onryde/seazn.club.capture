import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeSavedCode } from '@/domain/mode/savedCode';
import { UNPAIR_GIVE_UP_MS } from '@/hooks/useUnpair';
import { STORE_KEYS } from '@/services/modeStore';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { holdIntents } from '../../../test/holdIntents';
import { pairCode } from '../../../test/pairCode';
import { pressIn, pressOut } from '../../../test/press';
import {
  backgroundAndBack,
  flush,
  intentKinds,
  launchApp,
  scanFromHome,
  type LaunchedApp,
} from '../../../test/routedApp';

const IN_TWO_HOURS = new Date(TEST_NOW.getTime() + 2 * 3600_000);
const LABEL = 'Seazn XI v Fake CC';
const GO_LIVE = 'Go live. Press and hold for 3 seconds.';
const IDLE = 'Tap a mode, then scan its code.';

/** Scan a made-up code from Home, then go back Home: the code is kept, the engine paired. */
async function pairedThenHome(): Promise<LaunchedApp> {
  const app = await launchApp();
  await scanFromHome(app, captureRaw({ exp: epochSeconds(IN_TWO_HOURS) }));
  expect(app.nav.current()).toBe('stream');
  expect(app.engine.getSnapshot().state.kind).toBe('paired');
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await flush();
  expect(app.nav.current()).toBe('home');
  return app;
}

const forget = () => fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
const savedKeys = (app: LaunchedApp) => [...app.kv.entries.keys()];
const intentLines = (app: LaunchedApp) =>
  readRecord(app.record)
    .filter((entry) => entry.event.startsWith('intent.'))
    .map((entry) => ({ event: entry.event, fields: entry.fields }));

/**
 * I1 (final review, owner-visible): Forget while the code is paired or ended
 * clears it by native's own path, unpair or reset; and a paired or ended
 * engine that no saved code owns is an orphan, cleared on the way Home and
 * never shown as a Ready viewfinder. Task 24 (amendment, Identity rules in
 * JS): the unpair goes first, and the code is forgotten once the engine is
 * Idle; a Go live that raced it keeps the code; the unpair is bounded at 5 s.
 */
describe('Forget while the code is paired (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The reviewer's probe P2, end to end.
  it('unpairs the engine, and the next foreground stays Home with no Go live', async () => {
    const app = await pairedThenHome();
    forget();
    await flush();
    expect(savedKeys(app)).toEqual([]);
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(app.engine.getSnapshot()).toMatchObject({ state: { kind: 'idle' }, pairing: null });
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeNull();
    expect(screen.queryByText(LABEL)).toBeNull();
    expect(screen.getByText(IDLE)).toBeTruthy();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
  });

  it('records the scan’s pair and why the code was unpaired', async () => {
    const app = await pairedThenHome();
    forget();
    await flush();
    expect(intentLines(app)).toEqual([
      { event: 'intent.pair', fields: { action: 'pair', claim: 'new', slot: 1 } },
      { event: 'intent.unpair', fields: { action: 'forget' } },
    ]);
  });

  it('resets, and never unpairs, an engine ended while the phone sat on Home', async () => {
    const app = await pairedThenHome();
    act(() => app.engine.scene('stopped'));
    forget();
    await flush();
    expect(intentKinds(app)).toEqual(['pair', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('keeps the code until native answers the unpair, then forgets it and sends nothing more', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    forget();
    await flush();
    expect(native.held()).toEqual(['unpair']);
    expect(intentKinds(app)).toEqual(['pair']);
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    expect(savedKeys(app)).toEqual([]);
  });

  // The amendment: a remote Go live that raced the tap stands, and so does its code.
  it('keeps the code, and shows the broadcast, when a Go live is heard while the unpair is held', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    forget();
    await flush();
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(app.nav.current()).toBe('stream');
    act(() => native.release());
    await flush(UNPAIR_GIVE_UP_MS);
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.engine.getSnapshot().state.kind).not.toBe('idle');
    expect(app.nav.current()).toBe('stream');
    expect(intentKinds(app)).not.toContain('stop');
  });

  // CD26: native never answers, and the give-up is recorded. P4 review I1 (court stream): native ignores an unpair
  // while the operator's start is in flight (Pairings.kt), so an engine still paired at the give-up keeps its code: a
  // start then accepted arms with it, and the card still offers Forget, one tap to try again.
  it('keeps the code and the card when native never answers within 5 s, and records the give-up', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    forget();
    await flush(UNPAIR_GIVE_UP_MS + 100);
    expect(readRecord(app.record).map((entry) => entry.event)).toContain('unpair.gave-up');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    forget();
    await flush();
    expect(native.held()).toEqual(['unpair', 'unpair']);
  });

  // Court stream Task 13 fix round 1: native ignores an unpair while the operator's start is in flight, so Forget
  // waits for native's answer (useUnpair) and is honoured once the start fails, never dropped at the 5 s give-up.
  it('forgets once native fails a start that was in flight at the tap, and never gives up while it waits', async () => {
    const app = await pairedThenHome();
    app.engine.setStartAnswer('hold');
    act(() => app.engine.send({ kind: 'start' }));
    forget();
    await flush(UNPAIR_GIVE_UP_MS + 1_000);
    expect(intentKinds(app)).not.toContain('unpair');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(readRecord(app.record).map((entry) => entry.event)).not.toContain('unpair.gave-up');
    act(() => app.engine.setStartAnswer('failed'));
    await flush();
    expect(intentKinds(app)).toContain('unpair');
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });

  it('keeps the code when a start is accepted after the give-up, and shows its broadcast', async () => {
    const app = await pairedThenHome();
    holdIntents(app.engine, ['unpair']);
    forget();
    await flush(UNPAIR_GIVE_UP_MS + 100);
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.engine.getSnapshot().state.kind).not.toBe('idle');
    expect(app.nav.current()).toBe('stream');
  });

  // Second call: a double tap before the card goes clears the pairing once.
  it('unpairs once when Forget is pressed twice before native answers', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    const button = screen.getByRole('button', { name: 'Forget' });
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
  });

  // Final fix round 2, M-d: the reopen gate finds the forgotten pairing, an
  // orphan, while Forget's unpair is still unanswered. One unpair, not two.
  it('sends no second unpair when the phone comes back before native answers', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    forget();
    await flush();
    await backgroundAndBack(app);
    expect(native.held()).toEqual(['unpair']);
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(intentLines(app)).toEqual([
      { event: 'intent.pair', fields: { action: 'pair', claim: 'new', slot: 1 } },
      { event: 'intent.unpair', fields: { action: 'forget' } },
    ]);
    // The foreground reopened /stream under the unanswered unpair, so Home ended the clearing as `left` with the engine
    // still paired: the code stays (whole-branch review I2), as a start native is still holding may yet arm with it.
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  // Whole-branch review I2: Home unmounts under an unanswered Forget (the gear, a foreground reopen). The clearing ends
  // as `left` with the engine still paired, which native may be ignoring (its start in flight): the code stays, so a
  // start then accepted arms with it, and Home does not pull the operator back from where they went.
  it('keeps the code when Home is left while native has not answered the unpair', async () => {
    const app = await pairedThenHome();
    holdIntents(app.engine, ['unpair']);
    forget();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await flush(UNPAIR_GIVE_UP_MS + 100);
    expect(app.nav.current()).toBe('settings');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.nav.current()).toBe('stream');
  });

  // C4b-I2, the reviewer's probe P4: Forget X, then Y is scanned before the
  // unpair's 5 s are up. Home goes to /stream for Y, which ends X's unpair as
  // a give-up; the forget it then asks for is about X, and Y stays.
  it('keeps a code scanned while Forget’s unpair is unanswered', async () => {
    const app = await pairedThenHome();
    holdIntents(app.engine, ['unpair']);
    forget();
    await flush();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    await scanFromHome(
      app,
      captureRaw({ exp: epochSeconds(IN_TWO_HOURS), slot: 2, tok: 'tok-other-000000000000' }),
    );
    await flush(UNPAIR_GIVE_UP_MS + 1_000);
    const saved = app.kv.entries.get(STORE_KEYS.code('stream'));
    expect(saved === undefined ? null : decodeSavedCode(saved)?.slot).toBe(2);
    expect(app.nav.current()).toBe('stream');
    expect(app.engine.getSnapshot()).toMatchObject({
      state: { kind: 'paired' },
      pairing: { slot: 2 },
    });
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeTruthy();
  });

  // C4b-N1: Forget X, then X is scanned again while native has not yet
  // answered the unpair. The snapshot still shows X paired, but that pairing
  // is about to go: the scan pairs again rather than adopt it, and native,
  // applying intents in order, unpairs and then pairs X.
  it('pairs a code scanned again while Forget’s unpair is unanswered', async () => {
    const raw = captureRaw({ exp: epochSeconds(IN_TWO_HOURS) });
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair', 'pair']);
    forget();
    await flush();
    await scanFromHome(app, raw);
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    act(() => native.release());
    await flush();
    expect(intentKinds(app).slice(-2)).toEqual(['unpair', 'pair']);
    expect(app.engine.getSnapshot()).toMatchObject({
      state: { kind: 'paired' },
      pairing: { slot: 1 },
    });
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.nav.current()).toBe('stream');
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeTruthy();
  });

  // After an interruption: the unpair goes first, so a refused forget keeps
  // the code with an Idle engine; Continue pairs it again.
  it('keeps the code, and says so, when the phone refuses to forget it after the unpair', async () => {
    const app = await pairedThenHome();
    vi.spyOn(app.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    forget();
    await flush();
    expect(screen.getByText("Couldn't save on this phone. Try again.")).toBeTruthy();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });
});

/**
 * I1's second half: a paired or ended engine that no saved code owns is an
 * orphan. The reopen gate clears it on launch and on every foreground, by the
 * same path, and lands Home: never a Ready viewfinder for a code that is gone.
 */
describe('a pairing no saved code owns (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pairNative = (app: { engine: LaunchedApp['engine'] }) =>
    pairCode(app.engine, savedStreamCode());

  it('is unpaired at launch, and the app opens on Home', async () => {
    const app = await launchApp({ prepare: pairNative });
    expect(app.nav.current()).toBe('home');
    expect(app.nav.history).toEqual([]);
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    expect(intentLines(app)).toEqual([{ event: 'intent.unpair', fields: { action: 'orphan' } }]);
  });

  it('is unpaired on a return to the foreground, and Home stays', async () => {
    const app = await launchApp();
    act(() => pairNative(app));
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeNull();
    expect(intentKinds(app)).toEqual(['pair', 'unpair']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('is kept, and reopened, while its code is still saved but not active', async () => {
    const app = await pairedThenHome();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('stream');
    expect(intentKinds(app)).toEqual(['pair']);
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
  });

  it('is never touched on air, saved code or not', async () => {
    const app = await launchApp();
    act(() => {
      pairNative(app);
      app.engine.scene('live');
    });
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('stream');
    expect(intentKinds(app)).toEqual(['pair']);
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
  });

  // The rest of probe P2: nothing reachable goes live on the forgotten code.
  it('leaves nothing to go live on after Forget and a foreground', async () => {
    const app = await pairedThenHome();
    forget();
    await flush();
    await backgroundAndBack(app);
    const goLive = screen.queryByRole('button', { name: GO_LIVE });
    if (goLive !== null) {
      pressIn(goLive);
      await flush(3050);
      pressOut(goLive);
    }
    expect(intentKinds(app)).not.toContain('start');
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });
});
