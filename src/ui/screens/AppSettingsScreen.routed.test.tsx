import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { flush, launchApp } from '../../../test/routedApp';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

/** A saved stream code, so Home shows its Continue card (and a paired engine is no orphan). Made up. */
const SAVED_STREAM = { [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()) };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  restoreWindowSize();
});

const layoutOf = () => screen.getByTestId('app-settings').dataset.layout;
const openFromHome = async (app: Awaited<ReturnType<typeof launchApp>>) => {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await flush();
  expect(app.nav.current()).toBe('settings');
};

// The routed app is Home's gear and the route behind it, over the router double: what the operator does, in order.
describe('Home’s gear, the app’s Settings and the way back (owner, 2026-11-02)', () => {
  it('the gear opens Settings, Home’s button and Android Back both return Home, never to the camera', async () => {
    const app = await launchApp();
    await openFromHome(app);
    expect(screen.queryByRole('button', { name: 'Back to camera' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    await openFromHome(app);
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
    expect(app.nav.history).not.toContain('stream');
  });

  // The language moved off Home into Settings: a pick there is what Home speaks when the operator comes back.
  it('a language picked in Settings is the language of Home again, and is kept', async () => {
    const app = await launchApp();
    await openFromHome(app);
    fireEvent.click(screen.getByRole('button', { name: 'Language · English' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Inicio' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText(createTranslator('es').t('home.status.idle'))).toBeTruthy();
    expect(app.kv.entries.get(STORE_KEYS.lang)).toBe('es');
  });

  it('stays put on a return to the foreground, as from App info (P8)', async () => {
    const app = await launchApp();
    await openFromHome(app);
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('settings');
    expect(screen.getByRole('switch', { name: /^Start and stop automatically/ })).toBeTruthy();
  });

  it('moves to Live Stream when a broadcast starts remotely (A2)', async () => {
    const app = await launchApp({ prepare: (fakes) => fakes.engine.scene('paired-ready') });
    await openFromHome(app);
    act(() => app.engine.scene('live'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });

  // The Continue card is above the tiles: P6 hid the old tile gear then, and the app's gear does not go.
  it('is there with a Continue card standing above the tiles, and opens Settings (supersedes P6)', async () => {
    const app = await launchApp({ kvSeed: SAVED_STREAM });
    await flush();
    expect(app.nav.current()).toBe('home');
    const card = screen.getByText('Continue Live Stream'); // the card really is up
    expect(
      card.compareDocumentPosition(screen.getByTestId('tiles')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await openFromHome(app);
  });

  // The controller's ruling, 2026-11-02: App info is where the battery is set, and a paired phone holds no broadcast.
  it('stays on Settings on a return from App info with the engine paired, and moves once it is armed', async () => {
    const app = await launchApp({
      kvSeed: SAVED_STREAM,
      prepare: (fakes) => fakes.engine.scene('paired-ready'),
    });
    await flush();
    act(() => app.ports.navigation.go('home'));
    await flush();
    await openFromHome(app);
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('settings');
    expect(screen.getByRole('button', { name: 'Language · English' })).toBeTruthy();
    act(() => app.engine.scene('connecting'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });

  it.each(LANGS)(
    'turns sideways and back in %s, the title, both sections and the way home shown',
    async (lang) => {
      setWindowSize(640, 360);
      const app = await launchApp({ kvSeed: { [STORE_KEYS.lang]: lang } });
      const { t } = createTranslator(lang);
      fireEvent.click(screen.getByRole('button', { name: t('home.settings') }));
      await flush();
      expect(app.nav.current()).toBe('settings');
      const everything = () => {
        expect(screen.getByText(t('settings.app.title'))).toBeTruthy();
        expect(screen.getByText(t('settings.section.general'))).toBeTruthy();
        expect(screen.getByText(t('settings.section.stream'))).toBeTruthy();
        expect(screen.getByRole('button', { name: t('stream.home') })).toBeTruthy();
      };
      expect(layoutOf()).toBe('landscape');
      everything();
      setWindowSize(360, 640);
      expect(layoutOf()).toBe('portrait');
      everything();
    },
  );
});
