import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { STORE_KEYS } from '@/services/modeStore';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

function renderSettings(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<SettingsScreen />, options);
  view.navigation.go('stream');
  view.navigation.go('streamSettings');
  return view;
}

const overlaySwitch = () => screen.getByRole('switch', { name: 'Score preview' });
const LEAVE_ON_AIR = 'Stop the broadcast first — hold Stop.';

describe('Settings (spec §4)', () => {
  it('turns the score preview off, and saves it', async () => {
    const view = renderSettings();
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(overlaySwitch());
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"right"}'),
    );
  });

  it('turns it back on with a second press', async () => {
    const view = renderSettings();
    fireEvent.click(overlaySwitch());
    fireEvent.click(overlaySwitch());
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('true');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":true,"side":"right"}'),
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
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"left"}'),
    );
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
    expect(screen.getByRole('button', { name: 'Terug naar camera' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Linkerkant' })).toBeTruthy();
  });
});

describe('the viewfinder’s ways into Settings and Diagnostics (AGENTS §6)', () => {
  it.each(['armed-ready', 'connecting', 'live', 'holding', 'stopped', 'fatal'] as const)(
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

/** The stream stack as Expo Router keeps it: the viewfinder stays mounted under a pushed Settings. */
function Stack({ settings }: { settings: boolean }) {
  return (
    <>
      <StreamScreen />
      {settings ? <SettingsScreen /> : null}
    </>
  );
}

async function renderStack() {
  const fakes = createFakePorts({
    kvSeed: {
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
    },
  });
  const rendered = render(<Stack settings={false} />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  const openSettings = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    rendered.rerender(<Stack settings />);
  };
  return { ...rendered, ...fakes, openSettings };
}

/**
 * M21 and carry 9: Back belongs to whichever screen is showing. The viewfinder
 * re-subscribes its Back on every state change, so it is often asked first,
 * even under Settings; it answers only off a named sub-screen.
 */
describe('Back between the viewfinder and Settings (M21)', () => {
  it('a state change under Settings, then Back, returns to the camera without leaving', async () => {
    const view = await renderStack();
    view.openSettings();
    const setActive = vi.spyOn(view.ports.modeStore, 'setActive');
    act(() => view.engine.scene('live'));
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('stream');
    expect(screen.queryByText(LEAVE_ON_AIR)).toBeNull();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('Back on the camera after a round trip on air still says how to stop', async () => {
    const view = await renderStack();
    act(() => view.engine.scene('live'));
    view.openSettings();
    act(() => void view.back.press());
    expect(view.navigation.current()).toBe('stream');
    // Settings has not gone yet: the press is still the viewfinder's.
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('stream');
    expect(screen.getByText(LEAVE_ON_AIR)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  });

  it('Back on the camera after a round trip off air leaves for Home', async () => {
    const view = await renderStack();
    view.openSettings();
    act(() => void view.back.press());
    act(() => void view.back.press());
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
  });
});
