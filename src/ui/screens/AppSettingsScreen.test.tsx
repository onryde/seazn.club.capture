import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { LANGS, type Lang } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { STORE_KEYS } from '@/services/modeStore';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { AppSettingsScreen } from '@/ui/screens/AppSettingsScreen';
import {
  createFakePower,
  createFakeRecordUpload,
  createFakeUploadCredential,
} from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  restoreWindowSize();
});
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

/** Made up (AGENTS §13): belongs to no code. */
const CREDENTIAL: UploadCredential = {
  codeUrl: 'https://x/api/v1/capture/codes/c',
  token: 'made-up-token',
  expiresAtMs: null,
};

async function renderSettings(
  options: Parameters<typeof renderWithPorts>[1] = {},
  props: { recordSend?: boolean } = {},
) {
  const view = renderWithPorts(<AppSettingsScreen {...props} />, options);
  view.navigation.go('settings');
  await settle();
  return view;
}

const layoutOf = () => screen.getByTestId('app-settings').dataset.layout;
/** The names of the buttons, switches and radios inside an element, in document order: the controls a person reads. */
const namesIn = (root: HTMLElement) =>
  [...root.querySelectorAll('[role="button"], [role="switch"], [role="radio"]')].map((control) =>
    control.getAttribute('aria-label'),
  );
const headings = () => screen.getAllByRole('heading').map((heading) => heading.textContent);

describe('the app’s Settings: rows, not paragraphs (owner, 2026-11-02)', () => {
  it('has the title, the way back to Home, and no LIVE plate and no Diagnostics', async () => {
    await renderSettings();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to camera' })).toBeNull();
    expect(screen.queryByTestId('tally-plate')).toBeNull();
    expect(screen.queryByTestId('diagnostics-card')).toBeNull();
  });

  // Outside every mode there are no on-air rules, so a broadcast held behind it (a remote Go live moves the app to Live
  // Stream, but a render here is in the moment before) draws no LIVE plate: the plate belongs to the viewfinder's Settings.
  it('draws no LIVE plate even with a broadcast held', async () => {
    const view = await renderSettings();
    act(() => view.engine.scene('live'));
    expect(screen.queryByTestId('tally-plate')).toBeNull();
    expect(screen.queryByTestId('diagnostics-card')).toBeNull();
  });

  it('is General, then Live Stream, each a short heading over one card', async () => {
    await renderSettings();
    expect(headings()).toEqual(['General', 'Live Stream']);
    expect(screen.getAllByTestId('settings-group').length).toBeGreaterThanOrEqual(2);
  });

  it('General holds Language, Battery, Share record and Send record, in that order', async () => {
    await renderSettings({ uploadCredential: createFakeUploadCredential(CREDENTIAL) });
    const general = screen.getAllByTestId('settings-group')[0] as HTMLElement;
    expect(namesIn(general)).toEqual([
      'Language · English',
      'Battery · Unrestricted',
      'Share record',
      'Send record to Seazn',
    ]);
  });

  it('Live Stream holds the automatic switch and the side pair', async () => {
    await renderSettings();
    const stream = screen.getAllByTestId('settings-group')[1] as HTMLElement;
    expect(
      within(stream).getByRole('switch', { name: /^Start and stop automatically/ }),
    ).toBeTruthy();
    expect(within(stream).getByRole('radiogroup', { name: 'Controls' })).toBeTruthy();
    expect(
      within(stream)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Left', 'Right']);
  });

  // The owner's "no walls of text, no repeated explanations": the long paragraphs of the Stream Settings it replaces
  // are not carried over. Every line of text on the screen is a label, a value, a heading or a one-line helper.
  it('prints none of the long sentences Stream Settings printed', async () => {
    await renderSettings();
    const { t } = createTranslator('en');
    for (const key of [
      'settings.power.advice',
      'settings.power.hint',
      'settings.automatic.hint',
      'settings.power.label',
    ] as const)
      expect(screen.queryByText(new RegExp(t(key).slice(0, 20)))).toBeNull();
  });

  it('every line of text is short: at most six words', async () => {
    await renderSettings({ uploadCredential: createFakeUploadCredential(CREDENTIAL) });
    const texts = [...document.querySelectorAll('div')]
      .filter((node) => node.children.length === 0)
      .map((node) => node.textContent ?? '')
      .filter((text) => text.trim() !== '');
    expect(texts.length).toBeGreaterThan(8); // anti-vacuity: the leaves were read
    for (const text of texts)
      expect({ text, short: text.split(/\s+/).length <= 6 }).toEqual({ text, short: true });
  });
});

describe('Language, in General', () => {
  it('picking a language applies at once to the whole screen and keeps the pick', async () => {
    const view = await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Language · English' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Français' }));
    expect(screen.getByRole('button', { name: 'Langue · Français' })).toBeTruthy();
    expect(headings()).toEqual(['Général', 'Diffusion en direct']);
    expect(screen.getByText('Paramètres')).toBeTruthy();
    expect(view.kv.entries.get(STORE_KEYS.lang)).toBe('fr');
  });

  it('Android Back closes the open list first, then takes the screen home', async () => {
    const view = await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Language · English' }));
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('settings');
    expect(screen.queryByRole('radio', { name: 'Español' })).toBeNull();
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });
});

describe('Battery, in General (Android only)', () => {
  it('is absent where the mode is unknown, and leaves no stray line between the rows around it', async () => {
    const power = createFakePower(null);
    await renderSettings({ power, uploadCredential: createFakeUploadCredential(CREDENTIAL) });
    expect(screen.queryByRole('button', { name: /^Battery/ })).toBeNull();
    const general = screen.getAllByTestId('settings-group')[0] as HTMLElement;
    expect(namesIn(general)).toEqual([
      'Language · English',
      'Share record',
      'Send record to Seazn',
    ]);
    expect(within(general).getAllByTestId('settings-divider')).toHaveLength(2);
  });

  it('opens App info from its row, and says the path when the mode is not Unrestricted', async () => {
    const power = createFakePower('optimized');
    await renderSettings({ power });
    fireEvent.click(
      screen.getByRole('button', { name: 'Battery · Optimized · Battery → Unrestricted' }),
    );
    expect(power.opened).toBe(1);
  });

  it('is off from Arming on, with its one line why, and a return from App info is read again', async () => {
    const power = createFakePower('optimized');
    const view = await renderSettings({ power });
    act(() => view.engine.scene('connecting'));
    const row = screen.getByRole('button', {
      name: 'Battery · Optimized · After the broadcast',
    });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    expect(power.opened).toBe(0);
    act(() => view.engine.scene('stopped'));
    power.set('unrestricted');
    act(() => view.foreground.fire());
    expect(screen.getByRole('button', { name: 'Battery · Unrestricted' })).toBeTruthy();
  });
});

describe('the record rows, in General', () => {
  it('Share record shares the whole record', async () => {
    const view = await renderSettings();
    act(() => view.ports.logger.info('probe.line', { count: 1 }));
    const lines = view.record.lines().length;
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await settle();
    expect(view.share.shared).toHaveLength(1);
    expect(view.share.shared[0]?.split('\n')).toHaveLength(lines);
  });

  it('Send record to Seazn sends, and reads Sent · ref', async () => {
    const upload = createFakeRecordUpload();
    await renderSettings({
      uploadCredential: createFakeUploadCredential(CREDENTIAL),
      recordUpload: upload,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send record to Seazn' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Sent · ref R-TEST' })).toBeTruthy();
    expect(upload.calls).toBe(1);
  });

  it('with the switch off, Send record is not drawn and Share record is the last row, with no line after it', async () => {
    await renderSettings({}, { recordSend: false });
    expect(screen.queryByRole('button', { name: /^Send record/ })).toBeNull();
    const general = screen.getAllByTestId('settings-group')[0] as HTMLElement;
    expect(namesIn(general)).toEqual([
      'Language · English',
      'Battery · Unrestricted',
      'Share record',
    ]);
    expect(general.lastElementChild?.getAttribute('data-testid')).not.toBe('settings-divider');
  });

  // Minor 8 of the Batch 6 review: up to 1 MB must not ride the broadcast's uplink. From Arming on, Send is off with its
  // reason; Share record stays (it is local and uses no uplink).
  it.each(['arming-retrying', 'connecting', 'live', 'holding'] as const)(
    '%s: Send record is disabled with "Send it after the broadcast", Share record still works',
    async (scene) => {
      const upload = createFakeRecordUpload();
      const view = await renderSettings({
        uploadCredential: createFakeUploadCredential(CREDENTIAL),
        recordUpload: upload,
      });
      act(() => view.engine.scene(scene));
      const send = screen.getByRole('button', {
        name: 'Send record to Seazn · Send it after the broadcast',
      });
      expect(send.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(send);
      await settle();
      expect(upload.calls).toBe(0);
      const share = screen.getByRole('button', { name: 'Share record' });
      expect(share.getAttribute('aria-disabled')).toBeNull();
      fireEvent.click(share);
      await settle();
      expect(view.share.shared).toHaveLength(1);
    },
  );
});

describe('Live Stream, the two phone settings', () => {
  const automatic = () => screen.getByRole('switch', { name: /^Start and stop automatically/ });

  it('the switch reads on, says why in one line, and turning it off keeps the choice', async () => {
    const view = await renderSettings();
    expect(automatic().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('If the organiser turns it on')).toBeTruthy();
    fireEvent.click(automatic());
    await settle();
    expect(automatic().getAttribute('aria-checked')).toBe('false');
    expect(view.kv.entries.get(SETTINGS_KEY)).toContain('"automatic":false');
  });

  it('the side pair moves the controls and keeps the choice', async () => {
    const view = await renderSettings();
    // The default is the right (DEFAULT_STREAM_SETTINGS): the left is the move.
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    await settle();
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('false');
    expect(view.kv.entries.get(SETTINGS_KEY)).toContain('"side":"left"');
  });

  it('says so once, in one line, when a save is refused, and the choice holds for the session', async () => {
    const view = await renderSettings();
    vi.spyOn(view.kv, 'set').mockRejectedValue(new Error('refused'));
    fireEvent.click(automatic());
    await settle();
    expect(automatic().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText("Couldn't save that. It applies until the app closes.")).toBeTruthy();
  });
});

describe('Open-source licences', () => {
  it('is one row that opens the list and the libsrt source line, and closes it again', async () => {
    await renderSettings();
    const row = () => screen.getByRole('button', { name: 'Open-source licences' });
    expect(row().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
    fireEvent.click(row());
    expect(row().getAttribute('aria-expanded')).toBe('true');
    for (const entry of [
      'libsrt — MPL-2.0',
      'StreamPack — Apache-2.0',
      'expo-video — MIT',
      'React Native — MIT',
      'Expo — MIT',
    ])
      expect(screen.getByText(entry)).toBeTruthy();
    expect(screen.getByText('libsrt source code: https://github.com/Haivision/srt')).toBeTruthy();
    fireEvent.click(row());
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
  });
});

describe('Back', () => {
  it('the header’s Home returns Home, and Android Back does too, once', async () => {
    const view = await renderSettings();
    const go = vi.spyOn(view.navigation, 'go');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(view.navigation.current()).toBe('home');
    view.navigation.go('settings');
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('home');
    expect(go.mock.calls.filter(([route]) => route === 'home')).toHaveLength(2);
  });

  it('is not Settings’ to answer once the screen is Home’s again (M21)', async () => {
    const view = await renderSettings();
    view.navigation.go('home');
    let handled = true;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(false);
  });
});

describe('turning the phone', () => {
  it('upright it is one column; sideways two halves: General at the left, Live Stream and the licences at the right', async () => {
    setWindowSize(390, 844);
    await renderSettings();
    expect(layoutOf()).toBe('portrait');
    expect(screen.queryByTestId('app-settings-halves')).toBeNull();
    setWindowSize(844, 390);
    expect(layoutOf()).toBe('landscape');
    const halves = screen.getByTestId('app-settings-halves');
    expect(halves.children).toHaveLength(2);
    const [left, right] = [...halves.children] as HTMLElement[];
    expect(
      within(left as HTMLElement).getByRole('button', { name: 'Language · English' }),
    ).toBeTruthy();
    expect(
      within(right as HTMLElement).getByRole('switch', { name: /^Start and stop/ }),
    ).toBeTruthy();
    expect(
      within(right as HTMLElement).getByRole('button', { name: 'Open-source licences' }),
    ).toBeTruthy();
    expect(within(left as HTMLElement).queryByRole('switch')).toBeNull();
    setWindowSize(390, 844);
    expect(layoutOf()).toBe('portrait');
    expect(screen.getByRole('button', { name: 'Language · English' })).toBeTruthy();
  });

  it('keeps the chosen language through a turn', async () => {
    setWindowSize(390, 844);
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Language · English' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Nederlands' }));
    setWindowSize(844, 390);
    expect(screen.getByRole('button', { name: 'Taal · Nederlands' })).toBeTruthy();
    expect(headings()).toEqual(['Algemeen', 'Livestream']);
  });
});

describe.each(LANGS)('in %s', (lang: Lang) => {
  const { t } = createTranslator(lang);

  it('reads its title, its headings and its rows from the dictionary', async () => {
    await renderSettings({
      kvSeed: { [STORE_KEYS.lang]: lang },
      uploadCredential: createFakeUploadCredential(CREDENTIAL),
    });
    expect(screen.getByText(t('settings.app.title'))).toBeTruthy();
    expect(headings()).toEqual([t('settings.section.general'), t('settings.section.stream')]);
    expect(screen.getByRole('button', { name: t('stream.home') })).toBeTruthy();
    const general = screen.getAllByTestId('settings-group')[0] as HTMLElement;
    expect(namesIn(general)).toEqual([
      `${t('settings.language.label')} · ${t(`language.${lang}`)}`,
      `${t('settings.battery.label')} · ${t('settings.power.unrestricted')}`,
      t('diag.share'),
      t('record.send'),
    ]);
    expect(
      screen.getByRole('switch', {
        name: `${t('settings.automatic.row')} · ${t('settings.automatic.short')}`,
      }),
    ).toBeTruthy();
    const side = screen.getByRole('radiogroup', { name: t('settings.side.row') });
    // The row's own short words, which fit beside its label at 320 dp (appSettingsFit); not the viewfinder Settings'.
    expect(
      within(side)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label')),
    ).toEqual([t('settings.side.rowLeft'), t('settings.side.rowRight')]);
    expect(screen.getByRole('button', { name: t('settings.licences.label') })).toBeTruthy();
  });
});
