import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dimensions, StyleSheet, Text, type TextStyle } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { useEngineSync } from '@/hooks/useEngineSync';
import { HOLD_MS } from '@/hooks/useHold';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { colour, font } from '@/ui/theme/tokens';
import { describeBackFromSubScreen } from '../../../test/backFromSubScreen';
import { readRecord, type TestEngine } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_SECRETS } from '../../../test/fixtures/wire';
import { pairCode } from '../../../test/pairCode';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

// D13: a landscape test turns the window; every test starts with jsdom's own 0 × 0.
afterEach(restoreWindowSize);

function renderSettings(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<SettingsScreen />, options);
  view.navigation.go('stream');
  view.navigation.go('streamSettings');
  return view;
}

const automaticSwitch = () => screen.getByRole('switch', { name: 'Start and stop automatically' });

/** Settings with the shell's sync mounted, as the app has it. */
function SyncedSettings() {
  useEngineSync();
  return <SettingsScreen />;
}

const shareButton = () => screen.getByRole('button', { name: 'Share record' });
/** The board's Power paragraph: the existing label and advice, one em dash between (no new copy). */
const powerParagraph = (lang: (typeof LANGS)[number]) => {
  const { t } = createTranslator(lang);
  return `${t('settings.power.label')} — ${t('settings.power.advice')}`;
};
const faceOf = (text: string) => getComputedStyle(screen.getByText(text)).fontFamily;
const diagRows = () => screen.getAllByTestId('diag-row');

/**
 * The engine reporting a broadcast that offered no SRT (A18). The fake has no switch for it, so its
 * snapshot is wrapped, once per real snapshot (a new object each call would loop useSyncExternalStore).
 */
function reportSrtNotOffered(engine: TestEngine): void {
  const real = engine.getSnapshot.bind(engine);
  let seen: EngineSnapshot | undefined;
  let shown: EngineSnapshot | undefined;
  vi.spyOn(engine, 'getSnapshot').mockImplementation(() => {
    const snapshot = real();
    if (snapshot !== seen) {
      seen = snapshot;
      shown =
        snapshot.broadcast === null
          ? snapshot
          : { ...snapshot, broadcast: { ...snapshot.broadcast, srtOffered: false } };
    }
    return shown ?? snapshot;
  });
}
const cellsOf = (row: Element) => [...row.children].map((cell) => cell.textContent ?? '');
const layoutOf = () => screen.getByTestId('settings').dataset.layout;

/** The Diagnostics row for an item label; a missing row is a failure, never a skipped check. */
function rowOf(label: string): HTMLElement {
  const row = diagRows().find((candidate) => cellsOf(candidate)[1] === label);
  if (row === undefined) throw new Error(`no Diagnostics row for ${label}`);
  return row;
}

const scrolls = (element: Element) =>
  ['auto', 'scroll'].includes(getComputedStyle(element).overflowY);
/** The nearest ancestor that scrolls (a ScrollView), or null. */
function scrollerOf(element: Element): Element | null {
  for (let up = element.parentElement; up !== null; up = up.parentElement) {
    if (scrolls(up)) return up;
  }
  return null;
}

/**
 * The viewfinder, after the operator held Go live: a visit sends nothing until
 * then (amendment §2), so the hold is what puts a line in the record.
 */
async function startedViewfinder() {
  vi.useFakeTimers();
  try {
    const view = await renderViewfinder();
    pressIn(screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    return view;
  } finally {
    vi.useRealTimers();
  }
}

describe('Settings has no score preview control (D2 §4.1)', () => {
  // The four removed Score preview labels, one a language, copied here because the dictionaries no longer hold them.
  it.each(LANGS)(
    '%s: the automatic switch is the only switch, and no copy names a score preview',
    (lang) => {
      renderSettings({ deviceLanguages: [lang] });
      expect(screen.getAllByRole('switch')).toHaveLength(1);
      // The positive pair: the one switch is the automatic one, named in this language.
      const label = { en, es, fr, nl }[lang]['settings.automatic.label'];
      expect(screen.getByRole('switch', { name: label })).toBeTruthy();
      expect(screen.queryByText('Score preview')).toBeNull();
      expect(screen.queryByText('Vista previa del marcador')).toBeNull();
      expect(screen.queryByText('Aperçu du score')).toBeNull();
      expect(screen.queryByText('Scorevoorbeeld')).toBeNull();
    },
  );
});

describe('Settings (spec §4)', () => {
  it('turns the automatic start back on with a second press', async () => {
    const view = renderSettings();
    fireEvent.click(automaticSwitch());
    fireEvent.click(automaticSwitch());
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('true');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"right","automatic":true}'),
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

  it('reads what was saved before, a v2 record from before D2 included', async () => {
    renderSettings({
      kvSeed: { [SETTINGS_KEY]: '{"v":2,"overlay":true,"side":"left","automatic":false}' },
    });
    await waitFor(() => expect(automaticSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says when the phone refused to save, and keeps the choice', async () => {
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    const view = renderSettings();
    Object.assign(view.kv, refusing);
    expect(screen.queryByText("Couldn't save that. It applies until the app closes.")).toBeNull();
    fireEvent.click(automaticSwitch());
    expect(
      await screen.findByText("Couldn't save that. It applies until the app closes."),
    ).toBeTruthy();
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
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
    expect(screen.getByText('expo-video — MIT')).toBeTruthy();
    expect(screen.getByText('React Native — MIT')).toBeTruthy();
    expect(screen.getByText('Expo — MIT')).toBeTruthy();
    // Those five and no other: the shipped native code (D22), the WebView gone with the score preview (D2 §4.1).
    expect(screen.getAllByText(/ — (MPL-2\.0|Apache-2\.0|MIT)$/)).toHaveLength(5);
    expect(screen.getByText('libsrt source code: https://github.com/Haivision/srt')).toBeTruthy();
    fireEvent.click(expander);
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
  });

  it('gives the power advice', () => {
    renderSettings();
    expect(screen.getByText(powerParagraph('en'))).toBeTruthy();
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
    fireEvent.click(automaticSwitch());
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"left","automatic":false}'),
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
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":3,"side":"right","automatic":false}'),
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
    expect(screen.getByRole('switch', { name: 'Automatisch starten en stoppen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terug naar de camera' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Linkerkant' })).toBeTruthy();
    // Spec §6: the Diagnostics card is Settings' now, in the operator's language.
    expect(within(screen.getByTestId('diagnostics-card')).getByText('Diagnose')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logboek delen' })).toBeTruthy();
  });
});

describe('Diagnostics inside Settings (spec §6, Q1)', () => {
  it('is a card titled Diagnostics, with Share record in its header row', () => {
    renderSettings();
    const card = screen.getByTestId('diagnostics-card');
    const title = within(card).getByText('Diagnostics');
    const header = title.parentElement;
    expect(header).not.toBeNull();
    expect(header).not.toBe(card);
    // The button sits in the header row inside its own shrinkable cell (the narrowest half lets it wrap).
    expect(shareButton().parentElement?.parentElement).toBe(header);
  });

  it("lists Q1's nine rows as section | item | value, from the live report", () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const rows = diagRows();
    expect(rows).toHaveLength(9); // Q1's count, a literal (F13): 0 rows must fail, not pass as 0 = 0
    expect(rows.map(cellsOf)).toEqual([
      ['Link', 'Transport', 'SRT'],
      ['', 'Bitrate', '2840 kbps'],
      ['', 'Round trip', '48 ms'],
      ['Delivery', 'Viewers receiving', 'Yes'],
      ['', 'Behind live', '9.2 s'],
      ['', 'Checked', '1.5 s ago'],
      ['Phone', 'Battery', '74%'],
      ['', 'Heat', 'Normal'],
      ['Heartbeat', 'Last sent', '4 s ago'],
    ]);
    for (const row of rows) expect(row.children).toHaveLength(3);
  });

  it('shows nine rows of dashes when nothing has been measured', () => {
    const view = renderSettings();
    act(() => view.engine.scene('stopped'));
    expect(diagRows()).toHaveLength(9);
    expect(cellsOf(rowOf('Battery'))[2]).toBe('—');
    expect(cellsOf(rowOf('Last sent'))[2]).toBe('—');
  });

  it("leaves the other rows and the Engine section out (Q1), and the card's Phone section is named once", () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const left = [
      'Target',
      'Video',
      'Sending audio',
      'Resent',
      'Dropped',
      'Data used',
      'Camera',
      'Drain',
      'Charging',
      'Last result',
      'Failures',
      'Last report',
      'Record lines refused',
      'Record lines dropped',
      'Engine',
      'Session record',
    ];
    expect(left).toHaveLength(16);
    for (const text of left)
      expect({ text, shown: screen.queryByText(text) !== null }).toEqual({ text, shown: false });
    // The positive pair: the card is there, so an absent label is absent from a card that renders.
    expect(screen.getByText('Bitrate')).toBeTruthy();
    expect(screen.getAllByText('Phone')).toHaveLength(1);
  });

  it('draws the section column 84 dp wide, the item flexible and the value right-aligned', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const [section, label, value] = [...rowOf('Bitrate').children];
    expect(getComputedStyle(section as Element).width).toBe('84px');
    expect(getComputedStyle(label as Element).flexGrow).toBe('1');
    expect(getComputedStyle(value as Element).textAlign).toBe('right');
  });

  // AGENTS §5 and M25: Geist Mono carries the values, never the labels.
  it('sets the values in Geist Mono and the labels in Geist', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    expect(faceOf('2840 kbps')).toBe(font.numeric);
    // M6: Geist Medium, the `metricUnit` face, named rather than "not mono".
    expect(faceOf('Bitrate')).toBe(font.bodyMedium);
  });

  // D32: Diagnostics shows ticking values and is not the HUD: the engine's report is its clock. The 1 Hz
  // cadence itself is the engine's (the fake publishes each second); here a report is a `patch`.
  it('shows a changed bitrate in the Bitrate row as the engine reports it (D32)', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    expect(cellsOf(rowOf('Bitrate'))[2]).toBe('2840 kbps');
    act(() => view.engine.patch({ bitrateKbps: 2950 }));
    expect(cellsOf(rowOf('Bitrate'))[2]).toBe('2950 kbps');
    expect(screen.queryByText('2840 kbps')).toBeNull();
  });

  // I-2: the longest Transport value is RTMPS-only (A18). The fake engine has no switch for it, so its
  // snapshot is wrapped; the card's row is then read as the operator would.
  it('says RTMPS only on the Transport row when the broadcast offered no SRT (A18)', () => {
    const view = renderSettings();
    act(() => view.engine.scene('fell-back'));
    expect(cellsOf(rowOf('Transport'))[2]).toBe('RTMPS'); // the positive pair: offered, it is RTMPS alone
    reportSrtNotOffered(view.engine);
    act(() => view.engine.patch({}));
    expect(cellsOf(rowOf('Transport'))[2]).toBe('RTMPS only');
  });

  it('says it in Dutch: Alleen RTMPS', () => {
    const view = renderSettings({ deviceLanguages: ['nl'] });
    act(() => view.engine.scene('fell-back'));
    reportSrtNotOffered(view.engine);
    act(() => view.engine.patch({}));
    expect(cellsOf(rowOf('Transport'))[2]).toBe('Alleen RTMPS');
  });

  // The backstop: an item or a value that still ran long is one line with an ellipsis, never a second line
  // that would push the card past its half (settingsFit.test.ts proves the shipped copy never needs it).
  it('keeps every item and value to one line, ellipsised at the tail', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    expect(diagRows()).toHaveLength(9);
    for (const row of diagRows()) {
      for (const cell of [row.children[1], row.children[2]] as Element[]) {
        const style = getComputedStyle(cell);
        expect({ text: cell.textContent, whiteSpace: style.whiteSpace }).toEqual({
          text: cell.textContent,
          whiteSpace: 'nowrap',
        });
        expect(style.textOverflow).toBe('ellipsis');
      }
    }
  });

  // settingsFit.test.ts measures every string in the board's type; this is the witness that the card is set
  // in it: items in Geist 500 at 13, values in Geist Mono at 13, section names in Barlow Condensed at 14.
  it('sets the rows in the board’s type: items and values 13, section names 14', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const first = diagRows()[0] as Element;
    const [section, item, value] = [...first.children].map((cell) => getComputedStyle(cell));
    expect([section?.fontSize, item?.fontSize, value?.fontSize]).toEqual(['14px', '13px', '13px']);
    expect(item?.fontFamily).toContain('Geist_500Medium');
    expect(value?.fontFamily).toContain('GeistMono_400Regular');
    expect(section?.fontFamily).toContain('BarlowCondensed_600SemiBold');
  });

  it('has no session-record-lines, and shows no record line at all (spec §6)', () => {
    const view = renderSettings();
    act(() => {
      for (let n = 1; n <= 25; n += 1) view.ports.logger.info(`probe.line-${n}`);
    });
    // The positive pair: the record did take the lines, so none on screen is the drop.
    expect(view.record.lines().length).toBeGreaterThanOrEqual(25);
    expect(screen.queryByTestId('session-record-lines')).toBeNull();
    expect(screen.queryByText(/probe\.line-/)).toBeNull();
  });

  it('shares the whole record on one press, with no secret in it', async () => {
    const view = await startedViewfinder();
    view.rerender(<SettingsScreen />);
    const lines = view.record.lines().length;
    expect(lines).toBeGreaterThan(0);
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(1));
    const shared = view.share.shared[0] ?? '';
    expect(shared).toContain('intent.start');
    expect(shared.split('\n')).toHaveLength(lines);
    // M16: the QR's token is the only secret it carries now; every one is checked.
    expect(FIXTURE_SECRETS).toHaveLength(1);
    for (const secret of FIXTURE_SECRETS) {
      expect(secret.length).toBeGreaterThan(0);
      expect({ secret, leaked: shared.includes(secret) }).toEqual({ secret, leaked: false });
    }
    // M15: the count is on the scrub's allow-list, so it survives into the record.
    const entry = readRecord(view.record).find((line) => line.event === 'record.shared');
    expect(entry?.fields).toEqual({ count: shared.split('\n').length });
    expect(screen.queryByText("Couldn't share. Retry")).toBeNull();
  });

  // The old screen showed the last twenty lines; the card shows none, and Share sends them all.
  it('shares every line of a long record, not a tail of it', async () => {
    const view = renderSettings();
    act(() => {
      for (let n = 1; n <= 25; n += 1) view.ports.logger.info(`probe.line-${n}`);
    });
    const lines = view.record.lines().length;
    expect(lines).toBeGreaterThan(20); // the old tail was 20
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(1));
    expect(view.share.shared[0]?.split('\n')).toHaveLength(lines);
    expect(view.share.shared[0]).toContain('probe.line-1"');
  });

  it('shares twice when asked twice', async () => {
    const view = renderSettings();
    fireEvent.click(shareButton());
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(2));
  });

  // Round 2: a failed share says so ON the Share button (it replaces the label), so the card is the same
  // height as before and a card with 8 dp of slack is never pushed past its half.
  const FAILED = "Couldn't share. Retry";
  const failedButton = () => screen.getByRole('button', { name: FAILED });
  const cardShape = () =>
    [...screen.getByTestId('diagnostics-card').children].map((child) => child.tagName);

  it('says when sharing could not open on the Share button, and records it', async () => {
    const view = renderSettings();
    view.share.refuse();
    const before = cardShape();
    expect(screen.queryByRole('button', { name: FAILED })).toBeNull();
    fireEvent.click(shareButton());
    expect(await screen.findByRole('button', { name: FAILED })).toBeTruthy();
    // The label was replaced, not added to: no Share record button, no line of its own, the same children.
    expect(screen.queryByRole('button', { name: 'Share record' })).toBeNull();
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(cardShape()).toEqual(before);
    expect(before.length).toBeGreaterThan(2); // anti-vacuity: header, rows and the dev scenes
    expect(readRecord(view.record).map((entry) => entry.event)).toContain('record.share-failed');
    expect(readRecord(view.record).map((entry) => entry.event)).not.toContain('record.shared');
  });

  it('retries from the same button and gets the label back once a later share opens', async () => {
    const view = renderSettings();
    vi.spyOn(view.share, 'share').mockRejectedValueOnce(new Error('share sheet refused'));
    fireEvent.click(shareButton());
    expect(await screen.findByRole('button', { name: FAILED })).toBeTruthy();
    fireEvent.click(failedButton());
    await waitFor(() => expect(screen.queryByRole('button', { name: FAILED })).toBeNull());
    expect(shareButton()).toBeTruthy();
    expect(view.share.shared).toHaveLength(1);
  });

  // settingsFit.test.ts adds the header up with the Share box's padding (11) and border (1) each side.
  it('the Share box wears the padding and border the fit test adds', () => {
    renderSettings();
    const style = getComputedStyle(within(shareButton()).getByTestId('ghost-box'));
    expect([
      style.paddingLeft,
      style.paddingRight,
      style.borderLeftWidth,
      style.borderRightWidth,
    ]).toEqual(['11px', '11px', '1px', '1px']);
  });

  it('plays any fake scene in a development build', () => {
    const view = renderSettings();
    expect(screen.getByText('Fake engine (development only)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scene: holding' }));
    expect(view.engine.getSnapshot().state.kind).toBe('reconnecting');
    fireEvent.click(screen.getByRole('button', { name: 'Scene: fatal' }));
    expect(view.engine.getSnapshot().state).toMatchObject({ kind: 'ended', reason: 'fatal-error' });
  });

  it('shows no scenes in a release build', () => {
    renderSettings({ devTools: false, devEngine: null });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });

  it('shows no scenes with development tools off, whatever engine is wired', () => {
    renderSettings({ devTools: false });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
  });

  it('shows no scenes without the fake engine, even in a development build', () => {
    renderSettings({ devEngine: null });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
  });

  // Task 39: the dev controls for the preview's boundary and CD17's silence. They matter most with
  // native wired, where the fake engine's scenes are hidden, so the scenes' gate never hides them.
  it('offers Crash preview and Pause engine reports with native wired, and pauses native for 5 s', () => {
    const pauseReports = vi.fn();
    const nativeEngine = { pauseReports } as unknown as NativeCaptureEngine;
    renderSettings({ devEngine: null, nativeEngine });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause engine reports' }));
    expect(pauseReports.mock.calls).toEqual([[5_000]]);
    expect(screen.getByRole('button', { name: 'Crash preview' })).toBeTruthy();
  });

  it('offers no Pause engine reports without native, and neither control with development tools off', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: 'Crash preview' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause engine reports' })).toBeNull();
    cleanup();
    const nativeEngine = { pauseReports: vi.fn() } as unknown as NativeCaptureEngine;
    renderSettings({ devTools: false, nativeEngine });
    expect(screen.queryByRole('button', { name: 'Crash preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause engine reports' })).toBeNull();
  });

  it("Crash preview arms the viewfinder's preview to crash, until Show preview", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      renderSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Crash preview' }));
      cleanup();
      const view = await renderViewfinder();
      expect(screen.getByText('Camera preview stopped — the session carries on')).toBeTruthy();
      expect(
        readRecord(view.record).filter((entry) => entry.event === 'preview.crashed'),
      ).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Show preview' }));
      expect(screen.getByTestId('preview')).toBeTruthy();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('where Diagnostics sits (spec §6)', () => {
  // SP2 (F2): the licences were already under the power advice; this pins that order with the card after it.
  // R5: the battery row sits right after the power paragraph it extends.
  it('orders the switch hints, the side radios, the power paragraph, the battery row, the licences, then the card', () => {
    renderSettings();
    expect(layoutOf()).toBe('portrait'); // jsdom's 0 × 0 default (D10)
    const named: readonly (readonly [string, HTMLElement])[] = [
      ['automatic switch', automaticSwitch()],
      ['automatic hint', screen.getByText(en['settings.automatic.hint'])],
      ['left radio', screen.getByRole('radio', { name: 'Left' })],
      ['right radio', screen.getByRole('radio', { name: 'Right' })],
      ['power paragraph', screen.getByText(powerParagraph('en'))],
      ['battery row', screen.getByTestId('power-row')],
      ['licences', screen.getByRole('button', { name: 'Open-source licences' })],
      ['Diagnostics card', screen.getByTestId('diagnostics-card')],
    ];
    expect(named).toHaveLength(8);
    const misordered = named.slice(1).flatMap(([name, element], at) => {
      const before = named[at]?.[1];
      const follows = before?.compareDocumentPosition(element) === Node.DOCUMENT_POSITION_FOLLOWING;
      return follows ? [] : [name];
    });
    expect(misordered).toEqual([]);
  });

  it('keeps the card after the licences when they are open', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licences' }));
    const source = screen.getByText('libsrt source code: https://github.com/Haivision/srt');
    const card = screen.getByTestId('diagnostics-card');
    expect(source.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('in portrait, one column: the switches and the card share one scrolling column', () => {
    setWindowSize(390, 844);
    renderSettings();
    expect(layoutOf()).toBe('portrait');
    expect(screen.queryByTestId('settings-halves')).toBeNull();
    const scroller = scrollerOf(automaticSwitch());
    expect(scroller).not.toBeNull();
    expect(scrollerOf(screen.getByTestId('diagnostics-card'))).toBe(scroller);
    expect(getComputedStyle(screen.getByTestId('diagnostics-card')).flexDirection).toBe('column');
  });

  it('the helper really turns the window (positive control, D13)', () => {
    renderSettings();
    expect(layoutOf()).toBe('portrait');
    setWindowSize(844, 390);
    expect(Dimensions.get('window')).toMatchObject({ width: 844, height: 390 });
    expect(layoutOf()).toBe('landscape');
  });

  it('in landscape, settings on one half and Diagnostics on the other (spec §6)', () => {
    setWindowSize(640, 360); // spec §1's smallest landscape phone
    renderSettings();
    const halves = screen.getByTestId('settings-halves');
    expect(getComputedStyle(halves).flexDirection).toBe('row');
    expect(halves.children).toHaveLength(2);
    const [settingsHalf, diagnosticsHalf] = [...halves.children];
    expect(settingsHalf?.contains(screen.getByText('Open-source licences'))).toBe(true);
    expect(settingsHalf?.contains(automaticSwitch())).toBe(true);
    expect(diagnosticsHalf?.contains(screen.getByTestId('diagnostics-card'))).toBe(true);
    expect(settingsHalf?.contains(screen.getByTestId('diagnostics-card'))).toBe(false);
    // Two equal halves.
    for (const half of [settingsHalf, diagnosticsHalf]) {
      expect(getComputedStyle(half as Element).flexGrow).toBe('1');
    }
    // The way back runs across the top, over both halves (the board's header).
    expect(halves.contains(screen.getByRole('button', { name: 'Back to camera' }))).toBe(false);
  });

  // settingsFit.test.ts adds the card up from the board's numbers (10 above and below, rows of 22): this is
  // the rendered witness that DiagnosticsCard wears them, which a token-sum test cannot see.
  it('the card wears the board’s sizes: 10 above and below, 12 at the sides, rows of 22', () => {
    setWindowSize(640, 360);
    renderSettings();
    const card = getComputedStyle(screen.getByTestId('diagnostics-card'));
    expect([card.paddingTop, card.paddingBottom, card.paddingLeft, card.paddingRight]).toEqual([
      '10px',
      '10px',
      '12px',
      '12px',
    ]);
    expect(diagRows()).toHaveLength(9);
    for (const row of diagRows()) expect(getComputedStyle(row).minHeight).toBe('22px');
  });

  // settingsFit.test.ts adds Back and the Share record row as 48 each: Back is the icon button's side and Share's is
  // its button, whose 37 dp box is drawn inside it. This is the rendered witness.
  it('in landscape, Back and the Share record row are 48 dp tall, the heights the fit test adds', () => {
    setWindowSize(640, 360);
    renderSettings();
    const back = getComputedStyle(screen.getByRole('button', { name: 'Back to camera' }));
    expect({ name: 'Back to camera', height: back.height }).toEqual({
      name: 'Back to camera',
      height: '48px',
    });
    expect(getComputedStyle(shareButton()).minHeight).toBe('48px');
  });

  // Owner, device pass 2026-10-08 (a 360 dp tall phone): the card ran past the screen's foot and its last rows
  // could not be reached, because its half did not scroll. Each half now scrolls on its own; the card itself
  // holds no scroller of its own, so there is one scroll per half and never one inside another.
  it('in landscape, each half scrolls on its own, and the card holds no scroller inside it', () => {
    setWindowSize(640, 360);
    renderSettings();
    const halves = screen.getByTestId('settings-halves');
    const card = screen.getByTestId('diagnostics-card');
    const settingsScroller = scrollerOf(screen.getByText('Open-source licences'));
    const cardScroller = scrollerOf(card);
    expect(settingsScroller).toBe(halves.children[0]);
    expect(cardScroller).toBe(halves.children[1]);
    expect(cardScroller).not.toBe(settingsScroller);
    expect([...card.querySelectorAll('*')].filter(scrolls)).toEqual([]);
    expect(scrolls(card)).toBe(false);
  });

  it('in landscape, the way back works and a refused save is said on the settings half', async () => {
    setWindowSize(640, 360);
    const view = renderSettings();
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    Object.assign(view.kv, refusing);
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    const said = await screen.findByText("Couldn't save that. It applies until the app closes.");
    expect(screen.getByTestId('settings-halves').children[0]?.contains(said)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(view.navigation.current()).toBe('stream');
  });

  // m-3 (spec §7: Settings follows the phone): a rotation swaps the tree, so what the operator chose has
  // to live in the store and not in the tree. The switch, the radio and the saved file all survive, both ways.
  it('keeps the switch and the side across a rotation, both ways', async () => {
    setWindowSize(390, 844);
    const view = renderSettings();
    expect(layoutOf()).toBe('portrait');
    fireEvent.click(automaticSwitch());
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    const saved = '{"v":3,"side":"left","automatic":false}';
    await waitFor(() => expect(view.kv.entries.get(SETTINGS_KEY)).toBe(saved));
    for (const [width, height, layout] of [
      [844, 390, 'landscape'],
      [390, 844, 'portrait'],
    ] as const) {
      setWindowSize(width, height);
      expect(layoutOf()).toBe(layout); // the positive pair: it did rotate
      expect(automaticSwitch().getAttribute('aria-checked')).toBe('false');
      expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe(
        'false',
      );
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe(saved);
    }
  });

  // Order-dependent on purpose: it follows the landscape tests above, so the file's afterEach is
  // what it witnesses. A file that forgot `afterEach(restoreWindowSize)` fails here.
  it('starts on the jsdom window again after the landscape tests (D13)', () => {
    expect(Dimensions.get('window')).toMatchObject({ width: 0, height: 0 });
    renderSettings();
    expect(layoutOf()).toBe('portrait');
    expect(screen.queryByTestId('settings-halves')).toBeNull();
  });

  it('restoreWindowSize hands the window back, width and height both', () => {
    setWindowSize(844, 390);
    expect(Dimensions.get('window')).toMatchObject({ width: 844, height: 390 });
    restoreWindowSize();
    expect(Dimensions.get('window')).toMatchObject({ width: 0, height: 0 });
  });
});

/**
 * What the cascade paints a token as: a reference element wearing it. The colours are the TOKENS' declared meaning
 * (the brief: "on: lime track, knob colour.ground"), read the way the layout test reads them (a colour literal is
 * banned in a test, and a value read back from the component would prove the component equals itself).
 */
const PAINT = StyleSheet.create({
  surface: { backgroundColor: colour.surface },
  surface2: { backgroundColor: colour.surface2 },
  lime: { backgroundColor: colour.lime },
  ground: { backgroundColor: colour.ground },
  ink3: { backgroundColor: colour.ink3 },
  inkText: { color: colour.ink },
  ink2Text: { color: colour.ink2 },
  ink3Text: { color: colour.ink3 },
  groundText: { color: colour.ground },
  ink3Edge: { borderWidth: 1, borderColor: colour.ink3 },
});
type Painted = 'backgroundColor' | 'borderTopColor' | 'color';
function painted(style: TextStyle, read: Painted): string {
  const reference = render(
    <Text testID="paint-reference" style={style}>
      x
    </Text>,
  );
  const colourOf = getComputedStyle(reference.getByTestId('paint-reference'))[read];
  reference.unmount();
  return colourOf;
}
/** What the cascade gives an element that is given no background at all. */
const unpainted = () => painted({}, 'backgroundColor');
/** All four corners, as jsdom keeps them (it leaves the `border-radius` shorthand empty). */
const cornersOf = (style: CSSStyleDeclaration) => [
  style.borderTopLeftRadius,
  style.borderTopRightRadius,
  style.borderBottomRightRadius,
  style.borderBottomLeftRadius,
];
const ROUND = (dp: number) => [`${dp}px`, `${dp}px`, `${dp}px`, `${dp}px`];

const SWITCHES = [['Start and stop automatically', 'start and stop automatically']] as const;
/** The one switch, named once for the tests below that press it. */
const AUTOMATIC = 'Start and stop automatically';
const switchNamed = (name: string) => screen.getByRole('switch', { name });
const trackOf = (name: string) => within(switchNamed(name)).getByTestId('switch-track');
const knobOf = (name: string) => within(switchNamed(name)).getByTestId('switch-knob');
const px = (value: string) => Number.parseFloat(value);
let switchesChecked = 0;

// The owner's board, "Stream settings" (2026-10-08): the switch rows, the side control, Back and the Diagnostics
// heading, as the board draws them (measured from the PNG at 1.436 px per dp; the brief's numbers). Look only:
// every behaviour above is unchanged and its tests stay as they were.
describe('the switch rows wear the board (filled row, pill switch)', () => {
  it.each(SWITCHES)('%s: a filled card, no outline, 12 dp corners, one 48 dp row', (name) => {
    renderSettings();
    const row = getComputedStyle(switchNamed(name));
    expect(row.backgroundColor).toBe(painted(PAINT.surface, 'backgroundColor'));
    expect(row.borderTopWidth).toBe('0px');
    expect(cornersOf(row)).toEqual(ROUND(12)); // the card radius, as the board's
    expect(row.minHeight).toBe('48px'); // a tripod-sized target
    expect([row.flexDirection, row.alignItems]).toEqual(['row', 'center']);
    switchesChecked += 1;
  });

  // The board draws the label in full cream (its pixels are the ink token's, not the 80 % `control` role's).
  it.each(SWITCHES)('%s: its label is set in full ink', (name) => {
    renderSettings();
    const label = within(switchNamed(name)).getByText(name);
    expect(getComputedStyle(label).color).toBe(painted(PAINT.inkText, 'color'));
    expect(getComputedStyle(label).color).not.toBe(painted(PAINT.ink2Text, 'color'));
    expect(getComputedStyle(label).fontFamily).toBe(font.bodyMedium); // only the colour moved: still Geist 500
    expect(getComputedStyle(label).fontSize).toBe('14px');
  });

  it('puts the label on the left and the switch on the right', () => {
    renderSettings();
    for (const [name] of SWITCHES) {
      const label = within(switchNamed(name)).getByText(name);
      expect(getComputedStyle(label).flexGrow).toBe('1'); // it takes the line, so the switch is pushed right
      expect(label.compareDocumentPosition(trackOf(name))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  // Board: a 40 x 24 pill, an 18 dp knob, 3 dp in from the edge on every side. Off, the track is outlined.
  it.each([
    ['on', true],
    ['off', false],
  ] as const)('is a 40 x 24 pill with an 18 dp knob 3 dp in, %s', async (_state, on) => {
    renderSettings({
      kvSeed: { [SETTINGS_KEY]: `{"v":3,"side":"right","automatic":${on}}` },
    });
    await waitFor(() =>
      expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe(String(on)),
    );
    for (const [name] of SWITCHES) {
      const track = getComputedStyle(trackOf(name));
      const knob = getComputedStyle(knobOf(name));
      expect([track.width, track.height]).toEqual(['40px', '24px']);
      expect(cornersOf(track)).toEqual(ROUND(12)); // a pill: half its height
      expect([knob.width, knob.height]).toEqual(['18px', '18px']);
      expect(cornersOf(knob)).toEqual(ROUND(9)); // a circle
      // The knob's inset is the track's outline plus its padding, the same on every side: 3 dp.
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        const inset =
          px(track[`border${side}Width` as 'borderTopWidth']) +
          px(track[`padding${side}` as 'paddingTop']);
        expect({ name, side, inset }).toEqual({ name, side, inset: 3 });
      }
      // On, the knob sits at the right end; off, at the left.
      expect(track.justifyContent).toBe(on ? 'flex-end' : 'flex-start');
      switchesChecked += 1;
    }
  });

  it('paints on as a lime track with a night knob, off as an outlined track with a lilac knob', async () => {
    renderSettings();
    const on = getComputedStyle(trackOf(AUTOMATIC));
    expect(on.backgroundColor).toBe(painted(PAINT.lime, 'backgroundColor'));
    expect(getComputedStyle(knobOf(AUTOMATIC)).backgroundColor).toBe(
      painted(PAINT.ground, 'backgroundColor'),
    );
    fireEvent.click(switchNamed(AUTOMATIC));
    await waitFor(() => expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe('false'));
    const off = getComputedStyle(trackOf(AUTOMATIC));
    // The board's off track is a shade above the row (the night input fill, surface2), outlined in lilac.
    expect(off.backgroundColor).toBe(painted(PAINT.surface2, 'backgroundColor'));
    expect(off.borderTopColor).toBe(painted(PAINT.ink3Edge, 'borderTopColor'));
    expect(px(off.borderTopWidth)).toBeGreaterThanOrEqual(1);
    expect(px(off.borderTopWidth)).toBeLessThanOrEqual(2); // the brief: 1 to 2 dp
    expect(getComputedStyle(knobOf(AUTOMATIC)).backgroundColor).toBe(
      painted(PAINT.ink3, 'backgroundColor'),
    );
    // The two states are not one picture (anti-vacuity).
    expect(off.backgroundColor).not.toBe(on.backgroundColor);
  });

  it('keeps the same 40 x 24 box in both states, so a press does not move the row', async () => {
    renderSettings();
    const sizeOf = () => {
      const style = getComputedStyle(trackOf(AUTOMATIC));
      return [style.width, style.height, style.borderTopWidth, style.paddingTop];
    };
    const on = sizeOf();
    const onFill = getComputedStyle(trackOf(AUTOMATIC)).backgroundColor;
    expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switchNamed(AUTOMATIC));
    // The press really flipped it (else on === off proves nothing): the state said and the picture changed.
    await waitFor(() => expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe('false'));
    expect(getComputedStyle(trackOf(AUTOMATIC)).backgroundColor).not.toBe(onFill);
    expect(sizeOf()).toEqual(on);
    expect(on).toEqual(['40px', '24px', '1.5px', '1.5px']);
  });

  it('is still one control: the whole row presses, and the switch is hidden from a screen reader', async () => {
    renderSettings();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    for (const [name] of SWITCHES) {
      // Decorative: hidden from the accessibility tree, and no role of its own to be reached as a second control.
      const track = trackOf(name);
      expect(track.getAttribute('aria-hidden')).toBe('true');
      expect(track.getAttribute('role')).toBeNull();
      expect(knobOf(name).closest('[aria-hidden="true"]')).toBe(track);
    }
    // Pressing the picture of the switch presses the row.
    fireEvent.click(trackOf(AUTOMATIC));
    await waitFor(() => expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(within(switchNamed(AUTOMATIC)).getByText(AUTOMATIC));
    await waitFor(() => expect(switchNamed(AUTOMATIC).getAttribute('aria-checked')).toBe('true'));
  });

  it('checked the row, on and off (anti-vacuity)', () => {
    // 1 row in the card test + 1 row x 2 states in the pill test, run before this one.
    expect(SWITCHES).toHaveLength(1);
    expect(switchesChecked).toBe(1 + 1 * 2);
  });
});

describe('the side control wears the board (a segmented pair on the label’s line)', () => {
  const group = () => screen.getByRole('radiogroup', { name: 'Controls on the' });
  const radio = (name: string) => within(group()).getByRole('radio', { name });

  it('is one radiogroup named by its label, holding Left then Right', () => {
    renderSettings();
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map((each) => each.getAttribute('aria-label'))).toEqual(['Left', 'Right']);
    expect(screen.getAllByRole('radio')).toHaveLength(2); // and no radio outside it
  });

  it('sets its label in full ink, as the board does, and its words in the quieter ink2', () => {
    renderSettings();
    const label = screen.getByText('Controls on the');
    expect(getComputedStyle(label).color).toBe(painted(PAINT.inkText, 'color'));
    expect(getComputedStyle(label).fontFamily).toBe(font.bodyMedium);
    const word = within(radio('Left')).getByText('Left'); // the unchosen segment keeps `control`'s ink2
    expect(getComputedStyle(word).color).toBe(painted(PAINT.ink2Text, 'color'));
  });

  it('sits on the same line as its label, to the right of it', () => {
    renderSettings();
    const label = screen.getByText('Controls on the');
    const line = group().parentElement as HTMLElement;
    expect(line.contains(label)).toBe(true);
    expect(getComputedStyle(line).flexDirection).toBe('row');
    expect(getComputedStyle(line).alignItems).toBe('center');
    expect(getComputedStyle(label).flexGrow).toBe('1'); // the label takes the line, the pair is pushed right
    expect(label.compareDocumentPosition(group())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('is one outlined box: a 1 dp lilac line, 12 dp corners, the segments clipped inside', () => {
    renderSettings();
    const box = getComputedStyle(group());
    expect(box.flexDirection).toBe('row');
    expect(box.borderTopWidth).toBe('1px');
    expect(box.borderTopColor).toBe(painted(PAINT.ink3Edge, 'borderTopColor'));
    expect(cornersOf(box)).toEqual(ROUND(12));
    expect([box.overflowX, box.overflowY]).toEqual(['hidden', 'hidden']); // so the lime fill takes the box's corners
  });

  it('gives each segment a 48 dp tall target and the board’s 66 dp floor', () => {
    renderSettings();
    for (const name of ['Left', 'Right']) {
      const segment = getComputedStyle(radio(name));
      expect({ name, minHeight: segment.minHeight, minWidth: segment.minWidth }).toEqual({
        name,
        minHeight: '48px',
        minWidth: '66px',
      });
    }
  });

  it('fills the chosen segment lime with night text and leaves the other bare', async () => {
    renderSettings();
    const lime = painted(PAINT.lime, 'backgroundColor');
    const night = painted(PAINT.groundText, 'color');
    const quiet = painted(PAINT.ink2Text, 'color');
    const textOf = (name: string) => getComputedStyle(within(radio(name)).getByText(name)).color;
    // Right is chosen by default.
    expect(getComputedStyle(radio('Right')).backgroundColor).toBe(lime);
    expect(textOf('Right')).toBe(night);
    expect(getComputedStyle(radio('Left')).backgroundColor).toBe(unpainted());
    expect(textOf('Left')).toBe(quiet);
    // And the other way once Left is chosen: the fill moves, it is not painted on both.
    fireEvent.click(radio('Left'));
    await waitFor(() => expect(radio('Left').getAttribute('aria-checked')).toBe('true'));
    expect(getComputedStyle(radio('Left')).backgroundColor).toBe(lime);
    expect(textOf('Left')).toBe(night);
    expect(getComputedStyle(radio('Right')).backgroundColor).toBe(unpainted());
    expect(textOf('Right')).toBe(quiet);
    expect(night).not.toBe(quiet); // anti-vacuity: the two texts are two colours
  });

  it('has no divider line between the segments (the board draws none)', () => {
    renderSettings();
    for (const name of ['Left', 'Right']) {
      expect(getComputedStyle(radio(name)).borderTopWidth).toBe('0px');
      expect(getComputedStyle(radio(name)).borderLeftWidth).toBe('0px');
    }
  });
});

describe('Back wears the board (a square outlined icon button, no word)', () => {
  const backNames = new Set<string>();
  it('is a 48 dp outlined square holding a chevron, named Back to camera', () => {
    renderSettings();
    const back = screen.getByRole('button', { name: 'Back to camera' });
    const style = getComputedStyle(back);
    expect([style.width, style.height]).toEqual(['48px', '48px']);
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopColor).toBe(painted(PAINT.ink3Edge, 'borderTopColor'));
    expect(cornersOf(style)).toEqual(ROUND(12)); // the board's corners are the card's (measured: the same curve)
    expect(back.textContent).toBe(''); // no visible text; the name is the label alone
    const drawn = within(back).getByTestId('glyph');
    expect(drawn.dataset.name).toBe('back');
    expect(drawn.dataset.tone).toBe('ink2');
  });

  it.each(LANGS)('%s: keeps its name, and draws no word', (lang) => {
    renderSettings({ deviceLanguages: [lang] });
    const name = createTranslator(lang).t('stream.back');
    const back = screen.getByRole('button', { name });
    expect(back.textContent).toBe('');
    expect(within(back).getByTestId('glyph').dataset.name).toBe('back');
    backNames.add(name);
  });

  it('is named in four languages, four different ways (anti-vacuity)', () => {
    expect(LANGS).toHaveLength(4);
    expect(backNames.size).toBe(4);
    expect(backNames.has('Back to camera')).toBe(true);
  });

  it('stays the first control of the header, before the LIVE plate and the title', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const back = screen.getByRole('button', { name: 'Back to camera' });
    expect(back.compareDocumentPosition(screen.getByTestId('tally-plate'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(back.compareDocumentPosition(screen.getByText('Stream settings'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('the screen title wears the board (Barlow Condensed bold, about 24 dp)', () => {
  // Measured from the board: "STREAM SETTINGS" is 165.7 dp of ink, which Barlow Condensed 700 sets at 24 with the
  // 0.7 letterspacing the other caps roles carry (26 would be 181 dp). `title` stays 26: Home's tiles and the code
  // panel read it.
  it('is 24 caps with 0.7 letterspacing in ink, in the display face', () => {
    renderSettings();
    const title = getComputedStyle(screen.getByText('Stream settings'));
    expect(title.fontSize).toBe('24px');
    expect(title.lineHeight).toBe('27px');
    expect(title.letterSpacing).toBe('0.7px');
    expect(title.fontFamily).toContain('BarlowCondensed_700Bold');
    expect(title.textTransform).toBe('uppercase');
    expect(title.color).toBe(painted(PAINT.inkText, 'color'));
  });

  it('is the same size in another language', () => {
    renderSettings({ deviceLanguages: ['nl'] });
    expect(getComputedStyle(screen.getByText('Streaminstellingen')).fontSize).toBe('24px');
  });
});

describe('the Diagnostics heading wears the board (a lime pulse, then the name in the display face)', () => {
  const card = () => screen.getByTestId('diagnostics-card');
  const heading = () => within(card()).getByText('Diagnostics');

  it('draws an 18 dp lime pulse before the title, in the header row', () => {
    renderSettings();
    const pulse = within(card()).getByTestId('glyph');
    expect(pulse.dataset.name).toBe('pulse');
    expect(pulse.dataset.tone).toBe('lime');
    expect(pulse.dataset.size).toBe('18');
    expect(pulse.parentElement).toBe(heading().parentElement);
    expect(pulse.compareDocumentPosition(heading())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Only the pulse: the Back button's chevron is not in the card.
    expect(within(card()).getAllByTestId('glyph')).toHaveLength(1);
  });

  it('sets the title in Barlow Condensed bold, 18, caps and ink, with the copy left as written', () => {
    renderSettings();
    const style = getComputedStyle(heading());
    expect(style.fontFamily).toContain('BarlowCondensed_700Bold');
    expect(style.fontSize).toBe('18px');
    expect(style.textTransform).toBe('uppercase');
    expect(style.color).toBe(painted(PAINT.inkText, 'color'));
    expect(heading().textContent).toBe('Diagnostics'); // upper-cased by style, not by new copy
  });

  const headings = new Set<string>();
  it.each(LANGS)('%s: upper-cases by style, with the copy left as written', (lang) => {
    renderSettings({ deviceLanguages: [lang] });
    const written = createTranslator(lang).t('diag.title');
    const title = within(card()).getByText(written);
    expect(title.textContent).toBe(written);
    expect(getComputedStyle(title).textTransform).toBe('uppercase');
    expect(getComputedStyle(title).fontFamily).toContain('BarlowCondensed_700Bold');
    headings.add(written);
  });

  it('upper-cased four headings, and they are four words (anti-vacuity)', () => {
    expect(headings.size).toBe(LANGS.length);
    expect(headings.size).toBe(4);
  });

  // The header is the pulse, the title and the Share button on one line. The title takes the line (the button is
  // pushed to the right) and keeps its width; the button is the cell that gives when the half is narrow.
  it('lets the Share button give way before the title does', () => {
    renderSettings();
    const header = heading().parentElement as HTMLElement;
    expect(getComputedStyle(header).flexDirection).toBe('row');
    expect(getComputedStyle(heading()).flexGrow).toBe('1');
    expect(getComputedStyle(heading()).flexShrink).toBe('0');
    const cell = shareButton().parentElement as HTMLElement;
    expect(getComputedStyle(cell).flexShrink).toBe('1');
  });
});

// The board's Share record is a 37 dp box (its outline's rules are 35.9 dp apart, plus the 1 dp stroke) in 12 dp text. A
// tripod thumb needs 48, and TalkBack reads a node's bounds (a hit slop is not one): the button is the 48 dp target and
// the board's box is drawn inside it (GhostButton.test.tsx pins the component; this is the screen's use of it).
describe('Share record wears the board’s box inside a 48 dp button', () => {
  const box = () => within(shareButton()).getByTestId('ghost-box');

  it('is a 48 dp button holding a 37 dp box, centred in the header row', () => {
    renderSettings();
    expect(getComputedStyle(shareButton()).minHeight).toBe('48px');
    expect(getComputedStyle(box()).minHeight).toBe('37px');
    const header = (shareButton().parentElement as HTMLElement).parentElement as HTMLElement;
    expect(getComputedStyle(header).alignItems).toBe('center');
    expect(getComputedStyle(header).flexDirection).toBe('row');
  });

  it('sets its label at 12 dp, the board’s', () => {
    renderSettings();
    expect(getComputedStyle(within(box()).getByText('Share record')).fontSize).toBe('12px');
  });

  // R5: the battery row's button is the other small one (the D3 fixes plan's Task 5.3), above the card.
  it('is on Share record and the battery row’s button only: the box is not on any other button', () => {
    renderSettings();
    const boxed = screen
      .getAllByTestId('ghost-box')
      .map((box) => box.closest('[role="button"]')?.textContent);
    expect(boxed).toEqual(['App settings', 'Share record']);
  });

  it('keeps the same box and the same 48 dp when a share fails and the label changes', async () => {
    const view = renderSettings();
    vi.spyOn(view.share, 'share').mockRejectedValueOnce(new Error('share sheet refused'));
    fireEvent.click(shareButton());
    const failed = await screen.findByRole('button', { name: "Couldn't share. Retry" });
    expect(getComputedStyle(failed).minHeight).toBe('48px');
    expect(getComputedStyle(within(failed).getByTestId('ghost-box')).minHeight).toBe('37px');
  });
});

// The fit proofs (settingsFit.test.ts) add rows up from these: the board's gaps and paddings as numbers. A proof that
// reads the token it is judging proves the token, so these read what the screen renders, and the fit test pins the
// tokens to the same literals.
describe('the rows wear the gaps and paddings the fit proofs add up', () => {
  const gapOf = (element: Element) => getComputedStyle(element).getPropertyValue('gap');

  it.each(SWITCHES)(
    '%s: 12 dp at each side of the row, 8 dp between its label and its switch',
    (name) => {
      renderSettings();
      const row = getComputedStyle(switchNamed(name));
      expect([row.paddingLeft, row.paddingRight]).toEqual(['12px', '12px']);
      expect(gapOf(switchNamed(name))).toBe('8px');
    },
  );

  it('puts 8 dp between the side control’s label and its pair, and 12 dp inside each segment', () => {
    renderSettings();
    const pair = screen.getByRole('radiogroup', { name: 'Controls on the' });
    expect(gapOf(pair.parentElement as HTMLElement)).toBe('8px');
    for (const name of ['Left', 'Right']) {
      const segment = getComputedStyle(within(pair).getByRole('radio', { name }));
      expect([segment.paddingLeft, segment.paddingRight]).toEqual(['12px', '12px']);
    }
  });

  it('puts 8 dp between the Diagnostics pulse, its heading and Share record', () => {
    renderSettings();
    const header = screen.getByText('Diagnostics').parentElement as HTMLElement;
    expect(gapOf(header)).toBe('8px');
  });

  it('puts 6 dp between the card’s header and its rows', () => {
    renderSettings();
    expect(getComputedStyle(screen.getByTestId('diagnostics-card')).getPropertyValue('gap')).toBe(
      '6px',
    );
  });

  it('pads the portrait column 16 dp all round (the 320 dp card is 320 - 2 x 16 wide)', () => {
    renderSettings();
    const column = screen.getByTestId('diagnostics-card').parentElement as HTMLElement;
    const style = getComputedStyle(column);
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual([
      '16px',
      '16px',
      '16px',
      '16px',
    ]);
  });

  it('pads the landscape screen 16 dp at the sides and 12 above and below', () => {
    setWindowSize(640, 360);
    renderSettings();
    const style = getComputedStyle(screen.getByTestId('settings'));
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual([
      '12px',
      '16px',
      '12px',
      '16px',
    ]);
  });

  it('puts 8 dp between the way back and the two halves, 16 between the halves, in landscape', () => {
    setWindowSize(640, 360);
    renderSettings();
    const root = screen.getByTestId('settings');
    expect(getComputedStyle(root).getPropertyValue('gap')).toBe('8px');
    expect(getComputedStyle(screen.getByTestId('settings-halves')).getPropertyValue('gap')).toBe(
      '16px',
    );
  });
});

// The board sets the Power line and the licences link as quiet small print: one paragraph in the muted violet (the
// label and the advice joined by a dash, no new copy), and a bare underlined line, 12 dp.
describe('Power and the licences link wear the board (small print in ink3)', () => {
  const powers = new Set<string>();

  it.each(LANGS)(
    '%s: Power is one 12 dp ink3 paragraph, the label then a dash then the advice',
    (lang) => {
      renderSettings({ deviceLanguages: [lang] });
      const { t } = createTranslator(lang);
      const paragraph = screen.getByText(powerParagraph(lang));
      const style = getComputedStyle(paragraph);
      expect([style.fontSize, style.lineHeight, style.fontFamily]).toEqual([
        '12px',
        '16px',
        font.bodyMedium,
      ]);
      expect(style.color).toBe(painted(PAINT.ink3Text, 'color'));
      // One element: the label is not a line of its own, nor the advice.
      // (in the settings column: Spanish names a Diagnostics row "Batería" too, and that one is the card's own)
      const column = within(paragraph.parentElement as HTMLElement);
      expect(column.queryByText(t('settings.power.label'))).toBeNull();
      expect(column.queryByText(t('settings.power.advice'))).toBeNull();
      expect(paragraph.textContent).toBe(
        `${t('settings.power.label')} — ${t('settings.power.advice')}`,
      );
      powers.add(paragraph.textContent ?? '');
    },
  );

  it('is set like the hints above it, which the board draws alike (four languages, four paragraphs)', () => {
    expect(powers.size).toBe(4);
    renderSettings();
    const hint = getComputedStyle(screen.getByText(en['settings.automatic.hint']));
    const power = getComputedStyle(screen.getByText(powerParagraph('en')));
    expect([power.fontSize, power.lineHeight, power.color]).toEqual([
      hint.fontSize,
      hint.lineHeight,
      hint.color,
    ]);
  });

  it('draws the licences as an underlined 12 dp ink3 line in a 48 dp button, with no box around it', () => {
    renderSettings();
    const link = screen.getByRole('button', { name: 'Open-source licences' });
    const text = getComputedStyle(within(link).getByText('Open-source licences'));
    expect([text.fontSize, text.textDecorationLine]).toEqual(['12px', 'underline']);
    expect(text.color).toBe(painted(PAINT.ink3Text, 'color'));
    expect(getComputedStyle(link).minHeight).toBe('48px');
    expect(getComputedStyle(link).borderTopWidth).toBe('0px');
    expect(within(link).queryByTestId('ghost-box')).toBeNull();
  });

  it('still opens and closes the list from that line (it is a disclosure, not a link away)', () => {
    renderSettings();
    const link = screen.getByRole('button', { name: 'Open-source licences' });
    expect(link.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(link);
    expect(link.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('libsrt — MPL-2.0')).toBeTruthy();
  });
});

describe('the Diagnostics values are fixed-width, right-aligned (the board’s)', () => {
  it('sets every value in Geist Mono with tabular figures, flush right', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    expect(diagRows()).toHaveLength(9);
    for (const row of diagRows()) {
      const value = getComputedStyle(row.children[2] as Element);
      expect(value.fontFamily).toContain(font.numeric);
      expect(value.fontVariant).toBe('tabular-nums');
      expect(value.textAlign).toBe('right');
    }
  });

  it('leaves the item labels in Geist, with no tabular figures', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    for (const row of diagRows()) {
      const item = getComputedStyle(row.children[1] as Element);
      expect(item.fontFamily).toContain(font.bodyMedium);
      expect(item.fontVariant).not.toBe('tabular-nums');
    }
  });
});

describe('the viewfinder’s way into Settings (AGENTS §6; spec §3, §6: no Diagnostics button)', () => {
  // F3, spec §5: `stopped` and `fatal` are Ended, and an Ended leaves the viewfinder for Home at once, so there is no
  // Settings button to press on them. StreamScreen.ended.test.tsx and HomeScreen.ended.test.tsx own those two states.
  const SCENES = ['paired-ready', 'connecting', 'live', 'holding'] as const;

  it.each(SCENES)('Settings is there while %s, and Diagnostics is not', async (scene) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(view.navigation.current()).toBe('streamSettings');
  });

  it('covers its scenes', () => expect(SCENES).toHaveLength(4));

  it('reads in Spanish', async () => {
    await renderViewfinder({ deviceLanguages: ['es'] });
    expect(screen.getByRole('button', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Diagnóstico' })).toBeNull();
  });
});

describeBackFromSubScreen('Settings', <SettingsScreen />);
