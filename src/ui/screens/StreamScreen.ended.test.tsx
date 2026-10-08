import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { useReopenGate } from '@/hooks/useReopenGate';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import {
  CODE,
  endedRegion,
  holdControl,
  holdStopAfterLive,
  scanAndGoLive,
  stopBeforeLiveOver401,
} from '../../../test/endedFlow';
import { createFakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { OVERLAY_OFF_SEED } from '../../../test/overlayOff';
import { pairCode } from '../../../test/pairCode';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { wrapperFor } from '../../../test/renderWithPorts';
import { flush, intentKinds, launchApp, scanFromHome } from '../../../test/routedApp';

const plate = () => screen.getByTestId('tally-plate').textContent;
const homeVisits = (app: Awaited<ReturnType<typeof launchApp>>) =>
  app.nav.history.filter((route) => route === 'home').length;

/**
 * Spec §5: an Ended is not a screen of the viewfinder any more. The phone's Stop after live, and a fatal end, leave
 * it for Home by the one leave rule, and Home shows the card (HomeScreen.ended.test.tsx reads what it says). These
 * are the viewfinder's side: where it goes, what it sends, and what it does not do.
 */
describe('an Ended leaves the viewfinder for Home (spec §5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes Home after the Stop of a broadcast that went live: one stop, one reset, the code forgotten', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    expect(app.nav.current()).toBe('stream');
    await holdStopAfterLive();
    expect(app.nav.current()).toBe('home');
    expect(intentKinds(app).filter((kind) => kind === 'stop')).toHaveLength(1);
    expect(intentKinds(app).filter((kind) => kind === 'reset')).toHaveLength(1);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
    // The follow forgot the spent code at the Stop (amendment §2), so nothing is left to Continue.
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'operator-stopped',
      durationMs: 754_000,
      codeEnded: false,
    });
  });

  it('goes Home after a fatal end, keeping the code, and hands over its reason', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    act(() => app.engine.scene('fatal'));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(intentKinds(app).filter((kind) => kind === 'reset')).toHaveLength(1);
    // D11: a failed session is cleared, but its code is kept, so Continue re-arms.
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'fatal-error',
      durationMs: 754_000,
      codeEnded: false,
    });
  });

  // D7: an Ended whose session never went live (durationMs null) is only reachable as a fatal end, or as the 401
  // deferral's Stop; it still goes Home, and the card says it never went live.
  it('goes Home after an Ended that never went live, and hands over no time on air', async () => {
    const app = await launchApp();
    await scanFromHome(app, CODE);
    expect(app.nav.current()).toBe('stream');
    act(() => app.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'fatal-error',
      durationMs: null,
      codeEnded: false,
    });
  });

  // F14 a: the 401 heard while live is deferred to the Stop, and Ended keeps the flag (Projection.kt:38).
  it('hands over that the code ended when the Stop was of a broadcast held past a 401', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    act(() => app.engine.hear({ word: 'code-ended' }));
    expect(app.engine.getSnapshot().codeEndedPending).toBe(true);
    await holdStopAfterLive();
    expect(app.nav.current()).toBe('home');
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'operator-stopped',
      durationMs: 754_000,
      codeEnded: true,
    });
  });

  it('hands over that the code ended when a fatal end comes over a held 401 too', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    act(() => app.engine.hear({ word: 'code-ended' }));
    expect(app.engine.getSnapshot().codeEndedPending).toBe(true);
    act(() => app.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: 754_000 }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'fatal-error',
      durationMs: 754_000,
      codeEnded: true,
    });
  });

  // M-4. §5 says a Stop before the first frame stays on the viewfinder, and that holds while the pairing survives
  // the Stop (owner decision 1: Paired, Go live offered again; the describe below). Held past a 401 the Stop
  // ends the pairing, as the fake's `stop` has it from native: Ended, never live, the flag kept. There is nothing
  // to stay on Ready for, since the code is dead, so it leaves like any Ended, with the dead code forgotten.
  it('goes Home after a Stop before the first frame over a 401, since that Stop ends the pairing', async () => {
    const app = await launchApp();
    await stopBeforeLiveOver401(app);
    expect(app.engine.getSnapshot()).toMatchObject({
      state: { kind: 'idle' },
      codeEndedPending: false,
    });
    expect(app.nav.current()).toBe('home');
    expect(intentKinds(app).filter((kind) => kind === 'stop')).toHaveLength(1);
    expect(intentKinds(app).filter((kind) => kind === 'reset')).toHaveLength(1);
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'operator-stopped',
      durationMs: null,
      codeEnded: true,
    });
  });

  // M-4: Settings sits over a viewfinder that stays mounted (isStreamSubRoute), so the leave runs from there too.
  it('leaves Settings for Home with the card when a fatal end lands while Settings is open', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    // On air the icon row keeps Settings and hides Home (StreamScreen.layout.test.tsx), so this is the operator's own way in.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await flush();
    expect(app.nav.current()).toBe('streamSettings');
    // Settings really is open first, and no card yet: the positive half of the Home assertions below.
    expect(screen.getByRole('button', { name: 'Back to camera' })).toBeTruthy();
    expect(screen.getByText('Stream settings')).toBeTruthy();
    expect(endedRegion()).toBeNull();
    act(() => app.engine.scene('fatal'));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByRole('button', { name: 'Back to camera' })).toBeNull();
    expect(screen.queryByText('Stream settings')).toBeNull();
    expect(endedRegion()).not.toBeNull();
    expect(app.ports.endedNotice.getSnapshot()).toEqual({
      reason: 'fatal-error',
      durationMs: 754_000,
      codeEnded: false,
    });
  });

  // The Ended snapshot arriving twice before the leave finishes (a 1 Hz report on top of the end) is one end:
  // one card, one leave, one reset.
  it('leaves once for an Ended delivered twice before the leave settles', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    const heard = vi.fn();
    app.ports.endedNotice.subscribe(heard);
    const visits = homeVisits(app);
    act(() => {
      app.engine.scene('stopped');
      app.engine.patch({});
    });
    await flush();
    expect(homeVisits(app) - visits).toBe(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(intentKinds(app).filter((kind) => kind === 'reset')).toHaveLength(1);
  });

  // A reopen into a failed session (the gate lands on /stream while the code is kept) opens the viewfinder onto an
  // Ended. StrictMode runs its effects twice on mount; the leave, and the card, are still one.
  it('leaves once when it opens onto a failed session, under StrictMode', async () => {
    const saved = savedStreamCode();
    const heard = vi.fn();
    const app = await launchApp({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
      },
      prepare: (fakes) => {
        pairCode(fakes.engine, saved);
        fakes.engine.scene('fatal');
        fakes.ports.endedNotice.subscribe(heard);
      },
      around: (ui) => <StrictMode>{ui}</StrictMode>,
    });
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(app.ports.endedNotice.getSnapshot()).toMatchObject({ reason: 'fatal-error' });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(intentKinds(app).filter((kind) => kind === 'reset')).toHaveLength(1);
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  // M9: the card is put up only by a leave that goes Home, so one cancelled on air leaves none for the next Home.
  it('puts up no card when the broadcast is back on air before the leave finishes', async () => {
    const view = await renderViewfinder();
    let release = () => undefined as void;
    const written = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    vi.spyOn(view.ports.modeStore, 'forget').mockImplementation(() => written);
    act(() => view.engine.scene('stopped'));
    act(() =>
      view.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: Date.now() }),
    );
    await act(async () => release());
    expect(view.navigation.current()).toBe('stream');
    expect(view.ports.endedNotice.getSnapshot()).toBeNull();
  });
});

/**
 * Owner decision 1 (2026-10-05): the operator's Stop before the first frame ends the broadcast, not the pairing.
 * Through the whole app, with the engine follow and the reopen gate: the code stays saved, /stream stays on Ready
 * with Go live offered again, and the line says the stream stopped. Stop says which it does to a screen reader: no
 * "and unpair" until the broadcast is live, when a Stop still ends the pairing and Home asks for a rescan.
 */
describe('a Stop before live (owner decision 1) stays on the viewfinder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const GO_LIVE = 'Go live. Press and hold for 3 seconds.';

  it('keeps the pairing and the code: back on Ready, Go live offered again, the stream said stopped, no card', async () => {
    // The score preview is off here: with it on, a paired phone before air says Score ahead in the strip's one line.
    const app = await launchApp({ kvSeed: OVERLAY_OFF_SEED });
    await scanFromHome(app, CODE);
    expect(app.nav.current()).toBe('stream');
    const visits = homeVisits(app);
    // The organiser's Go live with the camera not ready: Armed, held and never live, for as long as the hold takes
    // (a start of the operator's own goes live a second on, before a 3 s hold ends).
    act(() => app.engine.setReady({ camera: false }));
    act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(app.engine.getSnapshot().state.kind).toBe('armed');
    expect(screen.queryByRole('button', { name: 'Hold to stop and unpair' })).toBeNull();
    await holdControl('Hold to stop');
    expect(intentKinds(app).slice(-1)).toEqual(['stop']);
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    expect(app.nav.current()).toBe('stream');
    expect(homeVisits(app)).toBe(visits);
    expect(endedRegion()).toBeNull();
    expect(app.ports.endedNotice.getSnapshot()).toBeNull();
    expect(screen.getByText('Stream stopped — waiting for Go live')).toBeTruthy();
    expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(intentKinds(app)).not.toContain('unpair');
  });

  // The positive pair of the test above: the same screen, Paired, after the organiser's stop (no Ended either).
  it('stays on the viewfinder when the organiser stops it, with no card', async () => {
    const app = await launchApp();
    await scanFromHome(app, CODE);
    act(() => app.engine.scene('paired-after-organiser-stop'));
    await flush();
    expect(app.nav.current()).toBe('stream');
    expect(endedRegion()).toBeNull();
    expect(app.ports.endedNotice.getSnapshot()).toBeNull();
    expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
  });

  it('once live, Stop ends the pairing and lands on Home, whose card asks to scan the code again', async () => {
    const app = await launchApp();
    await scanFromHome(app, CODE);
    await holdControl(GO_LIVE);
    await flush(1_000);
    expect(app.engine.getSnapshot().state.kind).toBe('publishing');
    expect(screen.queryByRole('button', { name: 'Hold to stop' })).toBeNull();
    await holdStopAfterLive();
    expect(intentKinds(app)).toEqual(['pair', 'start', 'stop', 'reset']);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText('Scan the code again for the next broadcast')).toBeTruthy();
  });
});

describe('reopening while live (spec §1: the engine wins)', () => {
  const pairs = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
    view.engine.intents.filter((intent) => intent.kind === 'pair');

  it('comes back to the live viewfinder without pairing again', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    // The one pair is the scan's, before the visit (renderViewfinder's default).
    expect(pairs(view)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
  });

  it('never pairs after that live session ends: it leaves for Home, and the visit sends no pair', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    act(() => view.engine.scene('stopped'));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(view.navigation.current()).toBe('home');
    expect(view.ports.endedNotice.getSnapshot()).toMatchObject({ reason: 'operator-stopped' });
    expect(pairs(view)).toHaveLength(1);
  });
});

/**
 * N4 (owner-visible): the code expires while an ended session sits on the phone, and the operator comes back to the
 * app. The reopen gate sends them Home with the expiry named; the next code they scan must open paired, never on the
 * old broadcast's ended session. Spec §5 took the sitting-on-Ended screen away (the viewfinder leaves at the end),
 * so the session now sits behind Home: it is the engine's, with no viewfinder over it.
 */
describe('a code that expired on an ended session (N4)', () => {
  it('lets the next code scanned pair, never reopening the old ended session', async () => {
    const saved = savedStreamCode();
    const fakes = createFakePorts({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
      },
    });
    pairCode(fakes.engine, saved);
    fakes.engine.scene('stopped');
    renderHook(() => useReopenGate(true), { wrapper: wrapperFor(fakes) });
    await act(async () => undefined);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
    const later = new Date(fakes.ports.clock().getTime() + 5 * 3600_000);
    fakes.setNow(later);
    act(() => fakes.foreground.fire());
    await vi.waitFor(() => expect(fakes.navigation.current()).toBe('home'));

    // M1: `router.replace('/')` unmounts the viewfinder before Home opens
    // anything, so the old visit can neither pair the new code nor adopt it.
    cleanup();
    expect(fakes.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'reset']);

    // Home opens a new code (spec §2) and pairs it, and the viewfinder mounts for it.
    const fresh = savedStreamCode({
      raw: CODE,
      savedAt: later,
      expiresAt: new Date(later.getTime() + 4 * 3600_000),
    });
    await act(() => fakes.ports.modeStore.open(fresh));
    act(() => pairCode(fakes.engine, fresh));
    render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
    fakes.navigation.go('stream');
    await act(async () => undefined);

    // The visit itself sends nothing: the third intent is Home's pair.
    expect(fakes.engine.intents.map((intent) => intent.kind)).toEqual(['pair', 'reset', 'pair']);
    expect(plate()).toBe('Ready');
    expect(endedRegion()).toBeNull();
    expect(fakes.ports.endedNotice.getSnapshot()).toBeNull();
  });
});

/**
 * C4b-I1 (spec, Ended; amendment, The engine port): the follow forgets the code at the operator's Stop, so by the
 * time the viewfinder leaves nothing is saved that owns the session. Nothing saved, it is nobody's, the gate's own
 * orphan rule, and the leave clears it: native must not hold an Ended session until the next foreground or scan.
 * Spec §5: the leave is the viewfinder's own, at the end, not a button the operator presses.
 */
describe('leaving after the operator’s Stop, with the code already forgotten (C4b-I1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const saved = savedStreamCode();

  it('sends exactly one reset', async () => {
    const app = await launchApp({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
      },
      prepare: (fakes) => pairCode(fakes.engine, saved),
    });
    act(() => app.engine.send({ kind: 'start' }));
    await flush(5_000);
    expect(app.nav.current()).toBe('stream');
    const before = app.engine.intents.length;
    act(() => app.engine.send({ kind: 'stop' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(intentKinds(app).slice(before)).toEqual(['stop', 'reset']);
    expect(app.engine.getSnapshot().state.kind).toBe('idle');
  });
});
