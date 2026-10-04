import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { useEngineSync } from '@/hooks/useEngineSync';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { describeBackFromSubScreen } from '../../../test/backFromSubScreen';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';

function renderSettings(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<SettingsScreen />, options);
  view.navigation.go('stream');
  view.navigation.go('streamSettings');
  return view;
}

const overlaySwitch = () => screen.getByRole('switch', { name: 'Score preview' });
const automaticSwitch = () => screen.getByRole('switch', { name: 'Start and stop automatically' });

/** Settings with the shell's sync mounted, as the app has it. */
function SyncedSettings() {
  useEngineSync();
  return <SettingsScreen />;
}

describe('Settings (spec §4)', () => {
  it('turns the score preview off, and saves it', async () => {
    const view = renderSettings();
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(overlaySwitch());
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe(
        '{\"v\":2,"overlay":false,"side":"right",\"automatic\":true}',
      ),
    );
  });

  it('turns it back on with a second press', async () => {
    const view = renderSettings();
    fireEvent.click(overlaySwitch());
    fireEvent.click(overlaySwitch());
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('true');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe(
        '{\"v\":2,"overlay":true,"side":"right",\"automatic\":true}',
      ),
    );
  });

  it('moves the controls to the left', async () => {
    const view = renderSettings();
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(view.kv.entries.get(SETTINGS_KEY)).toContain('"side":"left"'));
  });

  it('reads what was saved before', async () => {
    renderSettings({ kvSeed: { [SETTINGS_KEY]: '{"v":1,"overlay":false,"side":"left"}' } });
    await waitFor(() => expect(overlaySwitch().getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says when the phone refused to save, and keeps the choice', async () => {
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    const view = renderSettings();
    Object.assign(view.kv, refusing);
    expect(screen.queryByText("Couldn't save that. It applies until the app closes.")).toBeNull();
    fireEvent.click(overlaySwitch());
    expect(
      await screen.findByText("Couldn't save that. It applies until the app closes."),
    ).toBeTruthy();
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('says so when the side could not be saved, too', async () => {
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    const view = renderSettings();
    Object.assign(view.kv, refusing);
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(
      await screen.findByText("Couldn't save that. It applies until the app closes."),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
  });

  it('lists the licences behind an expander, with the libsrt source', () => {
    renderSettings();
    const expander = screen.getByRole('button', { name: 'Open-source licences' });
    expect(expander.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
    fireEvent.click(expander);
    expect(expander.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('libsrt — MPL-2.0')).toBeTruthy();
    expect(screen.getByText('StreamPack — Apache-2.0')).toBeTruthy();
    expect(screen.getByText('react-native-webview — MIT')).toBeTruthy();
    expect(screen.getByText('expo-video — MIT')).toBeTruthy();
    expect(screen.getByText('React Native — MIT')).toBeTruthy();
    expect(screen.getByText('Expo — MIT')).toBeTruthy();
    expect(screen.getByText('libsrt source code: https://github.com/Haivision/srt')).toBeTruthy();
    fireEvent.click(expander);
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
  });

  it('gives the power advice', () => {
    renderSettings();
    expect(
      screen.getByText(
        'A long match drains the battery. Plug in, or use a power bank on the tripod.',
      ),
    ).toBeTruthy();
  });

  it('goes back to the camera, by its button and by Back', () => {
    const view = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(view.navigation.current()).toBe('stream');
    view.navigation.go('streamSettings');
    expect(view.back.press()).toBe(true);
    expect(view.navigation.current()).toBe('stream');
  });

  it('carries the LIVE plate on air, and none off air (AGENTS §6)', () => {
    const view = renderSettings();
    expect(screen.queryByTestId('tally-plate')).toBeNull();
    act(() => view.engine.scene('live'));
    expect(screen.getByTestId('tally-plate').textContent).toBe('Live');
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByTestId('tally-plate')).toBeNull();
  });

  // AGENTS §6: protection belongs on a control that would disturb the
  // broadcast. Neither of these does, so both work on air.
  it('keeps both choices working on air', async () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    fireEvent.click(overlaySwitch());
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe(
        '{\"v\":2,"overlay":false,"side":"left",\"automatic\":true}',
      ),
    );
  });

  // Amendment §2, Settings: A4's switch, on by default, sent to native at once.
  it('turns the automatic start and stop off, and saves it', async () => {
    const view = renderSettings();
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Only when the organiser turns it on for the match')).toBeTruthy();
    fireEvent.click(automaticSwitch());
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe(
        '{"v":2,"overlay":true,"side":"right","automatic":false}',
      ),
    );
  });

  // The one named exception to AGENTS §6: it only affects the automatic stop (amendment §2).
  it('keeps the automatic switch usable on air', async () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    expect(automaticSwitch().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(automaticSwitch());
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(view.kv.entries.get(SETTINGS_KEY)).toContain('"automatic":false'));
  });

  it('keeps the automatic switch’s new value for the session when the save is refused (D23)', async () => {
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    const view = renderSettings();
    Object.assign(view.kv, refusing);
    fireEvent.click(automaticSwitch());
    expect(
      await screen.findByText("Couldn't save that. It applies until the app closes."),
    ).toBeTruthy();
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
  });

  // C4c-I1: native echoes the switch before its ack, so the screen and native agree at once.
  it('shows the switch’s new value as soon as native has it, paired', async () => {
    const view = renderWithPorts(<SyncedSettings />);
    act(() => pairCode(view.engine, savedStreamCode()));
    await act(() => view.ports.streamSettings.load());
    fireEvent.click(automaticSwitch());
    expect(view.engine.getSnapshot().pairing?.automatic).toBe(false);
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(automaticSwitch());
    expect(view.engine.getSnapshot().pairing?.automatic).toBe(true);
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('is reachable from the viewfinder on air', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(view.navigation.current()).toBe('streamSettings');
  });

  it('reads in Dutch', () => {
    renderSettings({ deviceLanguages: ['nl'] });
    expect(screen.getByRole('switch', { name: 'Scorevoorbeeld' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Automatisch starten en stoppen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terug naar de camera' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Linkerkant' })).toBeTruthy();
  });
});

describe('the viewfinder’s ways into Settings and Diagnostics (AGENTS §6)', () => {
  it.each(['paired-ready', 'connecting', 'live', 'holding', 'stopped', 'fatal'] as const)(
    'are both there while %s',
    async (scene) => {
      const view = await renderViewfinder();
      act(() => view.engine.scene(scene));
      fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
      expect(view.navigation.current()).toBe('streamDiagnostics');
      view.navigation.go('stream');
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(view.navigation.current()).toBe('streamSettings');
    },
  );

  it('read in Spanish', async () => {
    await renderViewfinder({ deviceLanguages: ['es'] });
    expect(screen.getByRole('button', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Diagnóstico' })).toBeTruthy();
  });
});

describeBackFromSubScreen('Settings', <SettingsScreen />);
