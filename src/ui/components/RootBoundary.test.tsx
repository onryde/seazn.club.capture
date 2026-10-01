import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectAudioLevel, selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { RootBoundary } from '@/ui/components/RootBoundary';
import { createFakePorts, readRecord, TEST_NOW } from '../../../test/fakePorts';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { pressIn, pressOut } from '../../../test/press';
import {
  backgroundAndBack,
  flush,
  intentKinds,
  launchApp,
  scanFromHome,
} from '../../../test/routedApp';

function Boom(): ReactElement {
  throw new Error('render failed at fake-token-0001');
}

const MAY_BE_LIVE = 'The broadcast may still be live. Try again to get back to Stop.';
const GO_LIVE = 'Go live. Press and hold for 3 seconds.';
const STOP = 'Stop. Press and hold for 3 seconds.';

/** Holds an action for its 3 s, as the operator does. */
async function hold(name: string) {
  const button = screen.getByRole('button', { name });
  pressIn(button);
  await flush(3050);
  pressOut(button);
  await flush(1100);
}

/** A part of the app that crashes on its next render while `on`; it re-renders on every state change. */
const crash = { on: false };
function HudPart(): null {
  const kind = useEngineSelector(selectStateKind);
  if (crash.on) throw new Error(`render failed while ${kind}`);
  return null;
}

/** The same, re-rendered by the sound level: a crash while armed, with no change of state. */
function MeterPart(): null {
  const level = useEngineSelector(selectAudioLevel);
  if (crash.on) throw new Error(`render failed at ${level}`);
  return null;
}

/**
 * M4 (final review): a render crash outside the overlay's own boundary
 * replaced the whole app, LIVE plate and Stop with it, while native kept
 * publishing, and the record never heard of it.
 */
describe('RootBoundary', () => {
  // React reports every caught render error on console.error; keep the run quiet.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the crash, with no message text, and lifts the splash (R15)', () => {
    const fakes = createFakePorts();
    render(
      <RootBoundary ports={fakes.ports}>
        <Boom />
      </RootBoundary>,
    );
    const crashes = readRecord(fakes.record).map(({ level, event, fields }) => ({
      level,
      event,
      fields,
    }));
    expect(crashes).toEqual([{ level: 'error', event: 'ui.crash', fields: {} }]);
    expect(fakes.record.lines().join('')).not.toContain('render failed');
    expect(fakes.splash.hides).toBe(1);
  });

  it('says the broadcast may still be live, and offers Try again', () => {
    const fakes = createFakePorts();
    render(
      <RootBoundary ports={fakes.ports}>
        <Boom />
      </RootBoundary>,
    );
    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.getByText(MAY_BE_LIVE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  // Outside every provider, it reads in the phone's language.
  it.each([
    [
      'es',
      'Algo falló',
      'Puede que la emisión siga en directo. Toca Reintentar para volver al botón Detener.',
      'Reintentar',
    ],
    [
      'fr',
      'Un problème est survenu',
      'Le direct est peut-être encore en cours. Touchez Réessayer pour revenir au bouton Arrêter.',
      'Réessayer',
    ],
    [
      'nl',
      'Er ging iets mis',
      'De uitzending is mogelijk nog live. Probeer opnieuw om terug te gaan naar Stoppen.',
      'Opnieuw proberen',
    ],
  ])('reads in the phone’s language: %s', (lang, title, note, retry) => {
    const fakes = createFakePorts({ deviceLanguages: [lang] });
    render(
      <RootBoundary ports={fakes.ports}>
        <Boom />
      </RootBoundary>,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.getByRole('button', { name: retry })).toBeTruthy();
  });

  describe('on air', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      crash.on = false;
      vi.useRealTimers();
    });

    it('a crash in the HUD, then Try again, puts Stop back under the operator’s thumb', async () => {
      const app = await launchApp({
        extra: <HudPart />,
        around: (ui, fakes) => <RootBoundary ports={fakes.ports}>{ui}</RootBoundary>,
      });
      await scanFromHome(
        app,
        captureRaw({ exp: epochSeconds(new Date(TEST_NOW.getTime() + 7_200_000)) }),
      );
      await hold(GO_LIVE);
      expect(app.engine.getSnapshot().state.kind).toBe('publishing');

      // The HUD crashes as native reports the fall-back to RTMPS.
      crash.on = true;
      act(() => app.engine.scene('fell-back'));
      expect(screen.getByText(MAY_BE_LIVE)).toBeTruthy();
      expect(screen.queryByRole('button', { name: STOP })).toBeNull();
      // Native never heard of the crash: the broadcast goes on.
      expect(app.engine.getSnapshot().state.kind).toBe('degraded');
      expect(intentKinds(app)).toEqual(['arm', 'start']);
      expect(readRecord(app.record).map((entry) => entry.event)).toContain('ui.crash');

      crash.on = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      expect(app.nav.current()).toBe('stream');
      await hold(STOP);
      expect(intentKinds(app)).toEqual(['arm', 'start', 'stop']);
      expect(app.engine.getSnapshot().state).toMatchObject({
        kind: 'ended',
        reason: 'operator-stopped',
      });
    });

    // Final fix round 2, I-A: the Stack starts afresh at Home after Try again,
    // while the navigation port outlives the remount. The port must not
    // believe it is still on the viewfinder.
    it('Try again never leaves the port believing the old route', async () => {
      const app = await launchOnAirThenCrash();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      expect(app.nav.current()).toBe('stream');
      expect(app.ports.navigation.current()).toBe('stream');
      expect(app.nav.history.slice(-1)).toEqual(['stream']);
      expect(screen.getByRole('button', { name: STOP })).toBeTruthy();
    });

    it('after Try again, the next foreground keeps the viewfinder and its Stop', async () => {
      const app = await launchOnAirThenCrash();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      await backgroundAndBack(app);
      expect(app.nav.current()).toBe('stream');
      expect(screen.getByRole('button', { name: STOP })).toBeTruthy();
    });

    it('a fresh scan after Try again opens the viewfinder', async () => {
      const app = await launchOnAirThenCrash();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      await hold(STOP);
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      await flush();
      expect(app.nav.current()).toBe('home');
      await scanFromHome(app, CODE);
      expect(app.nav.current()).toBe('stream');
      expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
    });
  });

  describe('armed', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      crash.on = false;
      vi.useRealTimers();
    });

    it('a crash before air: Try again returns to Arm, and Home then Continue still opens it', async () => {
      const app = await launchApp({
        extra: <MeterPart />,
        around: (ui, fakes) => <RootBoundary ports={fakes.ports}>{ui}</RootBoundary>,
      });
      await scanFromHome(app, CODE);
      crash.on = true;
      act(() => app.engine.patch({ audioLevel: 0.31 }));
      expect(screen.getByText(MAY_BE_LIVE)).toBeTruthy();
      crash.on = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      expect(app.nav.current()).toBe('stream');
      expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      await flush();
      expect(app.nav.current()).toBe('home');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await flush();
      expect(app.nav.current()).toBe('stream');
      expect(screen.getByRole('button', { name: GO_LIVE })).toBeTruthy();
      // Adopted every time, never re-armed: the same code's session.
      expect(intentKinds(app)).toEqual(['arm']);
    });
  });
});

const CODE = captureRaw({ exp: epochSeconds(new Date(TEST_NOW.getTime() + 7_200_000)) });

/** Scan, hold Go live, then crash the HUD as native reports the fall-back. */
async function launchOnAirThenCrash() {
  const app = await launchApp({
    extra: <HudPart />,
    around: (ui, fakes) => <RootBoundary ports={fakes.ports}>{ui}</RootBoundary>,
  });
  await scanFromHome(app, CODE);
  await hold(GO_LIVE);
  crash.on = true;
  act(() => app.engine.scene('fell-back'));
  crash.on = false;
  expect(screen.getByText(MAY_BE_LIVE)).toBeTruthy();
  return app;
}
