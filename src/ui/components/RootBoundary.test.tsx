import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { RootBoundary } from '@/ui/components/RootBoundary';
import { createFakePorts, readRecord, TEST_NOW } from '../../../test/fakePorts';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { pressIn, pressOut } from '../../../test/press';
import { flush, intentKinds, launchApp, scanFromHome } from '../../../test/routedApp';

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
      'Puede que la emisión siga en directo. Reintenta para volver a Detener.',
      'Reintentar',
    ],
    [
      'fr',
      'Un problème est survenu',
      'Le direct est peut-être encore en cours. Réessayez pour revenir à Arrêter.',
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
  });
});
