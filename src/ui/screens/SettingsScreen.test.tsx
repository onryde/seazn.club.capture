import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Dimensions } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import en from '@/i18n/en.json';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { useEngineSync } from '@/hooks/useEngineSync';
import { HOLD_MS } from '@/hooks/useHold';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { font } from '@/ui/theme/tokens';
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

const overlaySwitch = () => screen.getByRole('switch', { name: 'Score preview' });
const automaticSwitch = () => screen.getByRole('switch', { name: 'Start and stop automatically' });

/** Settings with the shell's sync mounted, as the app has it. */
function SyncedSettings() {
  useEngineSync();
  return <SettingsScreen />;
}

const shareButton = () => screen.getByRole('button', { name: 'Share record' });
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
    expect(shareButton().parentElement).toBe(header);
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

  it('says it in Dutch: alleen RTMPS', () => {
    const view = renderSettings({ deviceLanguages: ['nl'] });
    act(() => view.engine.scene('fell-back'));
    reportSrtNotOffered(view.engine);
    act(() => view.engine.patch({}));
    expect(cellsOf(rowOf('Transport'))[2]).toBe('alleen RTMPS');
  });

  // The backstop: a value that still ran long is one line with an ellipsis, never a second line that
  // would push the card past its half (settingsFit.test.ts proves the shipped copy never needs it).
  it('keeps every value to one line, ellipsised at the tail', () => {
    const view = renderSettings();
    act(() => view.engine.scene('live'));
    const values = diagRows().map((row) => row.children[2] as Element);
    expect(values).toHaveLength(9);
    for (const value of values) {
      const style = getComputedStyle(value);
      expect({ text: value.textContent, whiteSpace: style.whiteSpace }).toEqual({
        text: value.textContent,
        whiteSpace: 'nowrap',
      });
      expect(style.textOverflow).toBe('ellipsis');
    }
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
    expect(screen.queryByText("Couldn't open sharing.")).toBeNull();
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

  it('says when sharing could not open, and records it', async () => {
    const view = renderSettings();
    view.share.refuse();
    expect(screen.queryByText("Couldn't open sharing.")).toBeNull();
    fireEvent.click(shareButton());
    expect(await screen.findByText("Couldn't open sharing.")).toBeTruthy();
    expect(readRecord(view.record).map((entry) => entry.event)).toContain('record.share-failed');
    expect(readRecord(view.record).map((entry) => entry.event)).not.toContain('record.shared');
  });

  it('clears the message once a later share opens', async () => {
    const view = renderSettings();
    vi.spyOn(view.share, 'share').mockRejectedValueOnce(new Error('share sheet refused'));
    fireEvent.click(shareButton());
    expect(await screen.findByText("Couldn't open sharing.")).toBeTruthy();
    fireEvent.click(shareButton());
    await waitFor(() => expect(screen.queryByText("Couldn't open sharing.")).toBeNull());
    expect(view.share.shared).toHaveLength(1);
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
  it('orders the switch hints, the side radios, the power advice, the licences, then the card', () => {
    renderSettings();
    expect(layoutOf()).toBe('portrait'); // jsdom's 0 × 0 default (D10)
    const named: readonly (readonly [string, HTMLElement])[] = [
      ['score preview switch', overlaySwitch()],
      ['score preview hint', screen.getByText(en['settings.overlay.hint'])],
      ['automatic switch', automaticSwitch()],
      ['automatic hint', screen.getByText(en['settings.automatic.hint'])],
      ['left radio', screen.getByRole('radio', { name: 'Left' })],
      ['right radio', screen.getByRole('radio', { name: 'Right' })],
      ['power label', screen.getByText(en['settings.power.label'])],
      ['power advice', screen.getByText(en['settings.power.advice'])],
      ['licences', screen.getByRole('button', { name: 'Open-source licences' })],
      ['Diagnostics card', screen.getByTestId('diagnostics-card')],
    ];
    expect(named).toHaveLength(10);
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
    const scroller = scrollerOf(overlaySwitch());
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
    expect(settingsHalf?.contains(overlaySwitch())).toBe(true);
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

  // settingsFit.test.ts adds Back and Share record as 48 each (GhostButton's minHeight): this is the
  // rendered witness that the literal there is the button's.
  it('in landscape, Back and Share record are 48 dp tall, the heights the fit test adds', () => {
    setWindowSize(640, 360);
    renderSettings();
    for (const name of ['Back to camera', 'Share record']) {
      const button = screen.getByRole('button', { name });
      expect({ name, minHeight: getComputedStyle(button).minHeight }).toEqual({
        name,
        minHeight: '48px',
      });
    }
  });

  it('in landscape, the settings half scrolls and the Diagnostics card does not', () => {
    setWindowSize(640, 360);
    renderSettings();
    const halves = screen.getByTestId('settings-halves');
    const card = screen.getByTestId('diagnostics-card');
    // The positive pair: this probe sees a scroller where there is one.
    const settingsScroller = scrollerOf(screen.getByText('Open-source licences'));
    expect(settingsScroller).not.toBeNull();
    expect(halves.children[0]?.contains(settingsScroller)).toBe(true);
    expect(scrollerOf(card)).toBeNull();
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
  it('keeps the switches and the side across a rotation, both ways', async () => {
    setWindowSize(390, 844);
    const view = renderSettings();
    expect(layoutOf()).toBe('portrait');
    fireEvent.click(overlaySwitch());
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    const saved = '{"v":2,"overlay":false,"side":"left","automatic":true}';
    await waitFor(() => expect(view.kv.entries.get(SETTINGS_KEY)).toBe(saved));
    for (const [width, height, layout] of [
      [844, 390, 'landscape'],
      [390, 844, 'portrait'],
    ] as const) {
      setWindowSize(width, height);
      expect(layoutOf()).toBe(layout); // the positive pair: it did rotate
      expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
      expect(automaticSwitch().getAttribute('aria-checked')).toBe('true');
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

describe('the viewfinder’s way into Settings (AGENTS §6; spec §3, §6: no Diagnostics button)', () => {
  const SCENES = ['paired-ready', 'connecting', 'live', 'holding', 'stopped', 'fatal'] as const;

  it.each(SCENES)('Settings is there while %s, and Diagnostics is not', async (scene) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(view.navigation.current()).toBe('streamSettings');
  });

  it('covers its scenes', () => expect(SCENES).toHaveLength(6));

  it('reads in Spanish', async () => {
    await renderViewfinder({ deviceLanguages: ['es'] });
    expect(screen.getByRole('button', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Diagnóstico' })).toBeNull();
  });
});

describeBackFromSubScreen('Settings', <SettingsScreen />);
