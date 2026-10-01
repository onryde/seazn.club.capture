import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_KEYS } from '@/services/modeStore';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { streamSession } from '../../../test/fixtures/session';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { holdIntents } from '../../../test/holdIntents';
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

/** Scan a made-up code from Home, then go back Home: the code is kept, the engine armed. */
async function armedThenHome(): Promise<LaunchedApp> {
  const app = await launchApp();
  await scanFromHome(app, captureRaw({ exp: epochSeconds(IN_TWO_HOURS) }));
  expect(app.nav.current()).toBe('stream');
  expect(app.engine.getSnapshot().state.kind).toBe('armed');
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
 * I1 (final review, owner-visible): Forget while the code's session is armed
 * or ended disarms it by native's own path, stop then reset once Ended; and an
 * armed or ended engine that no saved code owns is an orphan, cleared on the
 * way Home and never shown as a Ready viewfinder.
 */
describe('Forget while the code’s session is armed (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The reviewer's probe P2, end to end.
  it('stops and resets the session, and the next foreground stays Home with no Go live', async () => {
    const app = await armedThenHome();
    forget();
    await flush();
    expect(savedKeys(app)).toEqual([]);
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
    expect(app.engine.getSnapshot()).toMatchObject({ state: { kind: 'idle' }, descriptor: null });
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeNull();
    expect(screen.queryByText(LABEL)).toBeNull();
    expect(screen.getByText(IDLE)).toBeTruthy();
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
  });

  it('records why the session was stopped and reset', async () => {
    const app = await armedThenHome();
    forget();
    await flush();
    expect(intentLines(app)).toEqual([
      { event: 'intent.arm', fields: { slot: 1 } },
      { event: 'intent.stop', fields: { action: 'forget' } },
      { event: 'intent.reset', fields: { action: 'forget' } },
    ]);
  });

  it('resets, and never stops again, a session ended while the phone sat on Home', async () => {
    const app = await armedThenHome();
    // The organiser ends the match while the code waits on the Continue card.
    act(() => app.engine.scene('stopped-by-organiser'));
    forget();
    await flush();
    expect(intentKinds(app)).toEqual(['arm', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('waits for native to answer the stop before it resets', async () => {
    const app = await armedThenHome();
    const native = holdIntents(app.engine, ['stop']);
    forget();
    await flush();
    expect(native.held()).toEqual(['stop']);
    expect(intentKinds(app)).toEqual(['arm']);
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });

  // Second call: a double tap before the card goes clears the session once.
  it('stops once when Forget is pressed twice before native answers', async () => {
    const app = await armedThenHome();
    const native = holdIntents(app.engine, ['stop']);
    const button = screen.getByRole('button', { name: 'Forget' });
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
  });

  // Final fix round 2, M-d: the reopen gate finds the forgotten session armed,
  // an orphan, while Forget's stop is still unanswered. One stop, not two.
  it('sends no second stop when the phone comes back before native answers', async () => {
    const app = await armedThenHome();
    const native = holdIntents(app.engine, ['stop']);
    forget();
    await flush();
    await backgroundAndBack(app);
    expect(native.held()).toEqual(['stop']);
    act(() => native.release());
    await flush();
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
    expect(intentLines(app)).toEqual([
      { event: 'intent.arm', fields: { slot: 1 } },
      { event: 'intent.stop', fields: { action: 'forget' } },
      { event: 'intent.reset', fields: { action: 'forget' } },
    ]);
    expect(app.nav.current()).toBe('home');
  });

  // After an interruption: a refused forget keeps the code, so its session is kept too.
  it('sends nothing when the phone refuses to forget the code', async () => {
    const app = await armedThenHome();
    vi.spyOn(app.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    forget();
    await flush();
    expect(screen.getByText("Couldn't save on this phone. Try again.")).toBeTruthy();
    expect(intentKinds(app)).toEqual(['arm']);
    expect(app.engine.getSnapshot().state.kind).toBe('armed');
  });
});

/**
 * I1's second half: an armed or ended engine that no saved code owns is an
 * orphan. The reopen gate clears it on launch and on every foreground, by the
 * same path, and lands Home: never a Ready viewfinder for a code that is gone.
 */
describe('a session no saved code owns (I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const session = streamSession();
  const armNative = (app: { engine: LaunchedApp['engine'] }) =>
    app.engine.send({
      kind: 'arm',
      session,
      heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
    });

  it('is stopped and reset at launch, and the app opens on Home', async () => {
    const app = await launchApp({ prepare: armNative });
    expect(app.nav.current()).toBe('home');
    expect(app.nav.history).toEqual([]);
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    expect(intentLines(app)).toEqual([
      { event: 'intent.stop', fields: { action: 'orphan' } },
      { event: 'intent.reset', fields: { action: 'orphan' } },
    ]);
  });

  it('is stopped and reset on a return to the foreground, and Home stays', async () => {
    const app = await launchApp();
    act(() => armNative(app));
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByRole('button', { name: GO_LIVE })).toBeNull();
    expect(intentKinds(app)).toEqual(['arm', 'stop', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('is kept, and reopened, while its code is still saved but not active', async () => {
    const app = await armedThenHome();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('stream');
    expect(intentKinds(app)).toEqual(['arm']);
    expect(app.engine.getSnapshot().state.kind).toBe('armed');
  });

  it('is never stopped on air, saved code or not', async () => {
    const app = await launchApp();
    act(() => {
      armNative(app);
      app.engine.scene('live');
    });
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('stream');
    expect(intentKinds(app)).toEqual(['arm']);
    expect(
      screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' }),
    ).toBeTruthy();
  });

  // The rest of probe P2: nothing reachable goes live on the forgotten code.
  it('leaves nothing to go live on after Forget and a foreground', async () => {
    const app = await armedThenHome();
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
