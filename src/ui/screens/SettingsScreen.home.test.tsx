import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { STORE_KEYS } from '@/services/modeStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { flush, launchApp } from '../../../test/routedApp';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  restoreWindowSize();
});

const layoutOf = () => screen.getByTestId('settings').dataset.layout;
const halves = () => screen.getByTestId('settings-halves').children.length;

describe('Stream Settings from Home (R2, spec §6)', () => {
  it('opens without Diagnostics and without a LIVE plate, with both phone settings', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    expect(app.nav.current()).toBe('homeSettings');
    expect(screen.queryByTestId('diagnostics-card')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Start and stop automatically' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Controls on the' })).toBeTruthy();
    expect(screen.queryByTestId('tally-plate')).toBeNull();
  });

  // R5: both variants carry the battery row (spec §8), right after the power paragraph.
  it('carries the battery row, as the Live Stream variant does', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    expect(screen.getByTestId('power-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'App settings' })).toBeTruthy();
  });

  // N33: a phone with nothing paired, a replaced one among them, can still hand its record over from here.
  it('carries the record row, and Share record shares the whole record from it', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    act(() => app.ports.logger.info('probe.line', { count: 1 }));
    const lines = app.record.lines().length;
    expect(lines).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await flush();
    expect(app.share.shared).toHaveLength(1);
    expect(app.share.shared[0]?.split('\n')).toHaveLength(lines);
  });

  // Its way back is named for where it goes: Home (`stream.home`), never "Back to camera".
  it('goes back to Home by its button and by Back, never to the camera', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    expect(screen.queryByRole('button', { name: 'Back to camera' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
    expect(app.nav.history).not.toContain('stream');
  });

  it('stays put on a return to the foreground, as from App info (P8)', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('homeSettings');
    expect(screen.getByRole('switch', { name: 'Start and stop automatically' })).toBeTruthy();
  });

  it('moves to Live Stream when a broadcast starts remotely (A2)', async () => {
    const app = await launchApp({ prepare: (fakes) => fakes.engine.scene('paired-ready') });
    act(() => app.ports.navigation.go('homeSettings'));
    await flush();
    expect(app.nav.current()).toBe('homeSettings');
    act(() => app.engine.scene('live'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });

  it.each(LANGS)(
    'turns sideways and back in %s, the title and both settings shown',
    async (lang) => {
      setWindowSize(640, 360);
      const app = await launchApp({ kvSeed: { [STORE_KEYS.lang]: lang } });
      act(() => app.ports.navigation.go('homeSettings'));
      await flush();
      const { t } = createTranslator(lang);
      const bothSettings = () => {
        expect(screen.getByText(t('settings.title'))).toBeTruthy();
        expect(screen.getByRole('switch', { name: t('settings.automatic.label') })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: t('settings.side.label') })).toBeTruthy();
      };
      expect(layoutOf()).toBe('landscape');
      bothSettings();
      expect(screen.getByRole('button', { name: t('stream.home') })).toBeTruthy();
      setWindowSize(360, 640);
      expect(layoutOf()).toBe('portrait');
      bothSettings();
    },
  );
});

describe('the Home variant, rendered on its own', () => {
  // The routed app never holds this screen on air (the follow moves it to Live Stream), so the plate's absence is
  // proven here, against the Live Stream variant in the same state.
  it.each([
    ['stream', 1],
    ['home', 0],
  ] as const)('from %s, on air, draws %i LIVE plate', (from, plates) => {
    const view = renderWithPorts(<SettingsScreen from={from} />);
    act(() => view.engine.scene('live'));
    expect(screen.queryAllByTestId('tally-plate')).toHaveLength(plates);
  });

  // Landscape with no card: the second half is not drawn, so the settings take the width.
  it.each([
    ['stream', 2],
    ['home', 1],
  ] as const)('from %s, sideways, has %i halves', (from, count) => {
    setWindowSize(640, 360);
    renderWithPorts(<SettingsScreen from={from} />);
    expect(layoutOf()).toBe('landscape');
    expect(halves()).toBe(count);
  });
});
