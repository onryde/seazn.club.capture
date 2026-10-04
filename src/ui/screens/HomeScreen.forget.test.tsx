import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // CD26: native never answers. The operator asked, so the code goes; the
  // engine still paired is then an orphan, unpaired at the next settle.
  it('forgets the code when native never answers within 5 s, and records the give-up', async () => {
    const app = await pairedThenHome();
    const native = holdIntents(app.engine, ['unpair']);
    forget();
    await flush(UNPAIR_GIVE_UP_MS - 100);
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    await flush(200);
    expect(savedKeys(app)).toEqual([]);
    expect(readRecord(app.record).map((entry) => entry.event)).toContain('unpair.gave-up');
    await backgroundAndBack(app);
    expect(native.held()).toEqual(['unpair', 'unpair']);
    expect(app.nav.current()).toBe('home');
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
    expect(app.nav.current()).toBe('home');
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
    expect(
      screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' }),
    ).toBeTruthy();
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
