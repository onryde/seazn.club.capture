import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { LANGS, type Lang } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import type { PowerMode } from '@/services/devicePorts';
import { STORE_KEYS } from '@/services/modeStore';
import { BatteryRow, SendRecordRow, ShareRecordRow } from '@/ui/components/SettingsDeviceRows';
import { colour } from '@/ui/theme/tokens';
import { createFakeRecordUpload, createFakeUploadCredential } from '../../../test/fakePorts';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

describe('BatteryRow: the battery mode in Android’s own word, opening App info', () => {
  const mode = (value: PowerMode, held = false, open = vi.fn()) =>
    renderWithPorts(<BatteryRow mode={value} held={held} open={open} />);

  it('unrestricted: the word in ink2, no helper (nothing to do), and a press opens App info', () => {
    const open = vi.fn();
    mode('unrestricted', false, open);
    const row = screen.getByRole('button', { name: 'Battery · Unrestricted' });
    expect(getComputedStyle(screen.getByText('Unrestricted')).color).toBe(edgeOf(colour.ink2));
    expect(screen.queryByText('Battery → Unrestricted')).toBeNull();
    fireEvent.click(row);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['optimized', 'Optimized'],
    ['restricted', 'Restricted'],
  ] as const)(
    '%s: the word in caution, never red, with the path as its one helper line',
    (value, word) => {
      mode(value);
      expect(getComputedStyle(screen.getByText(word)).color).toBe(edgeOf(colour.caution));
      expect(screen.getByText('Battery → Unrestricted')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: `Battery · ${word} · Battery → Unrestricted` }),
      ).toBeTruthy();
    },
  );

  // I3 of the Batch 5 review, AGENTS §6: App info is one tap from Force stop, so from Arming on the row is off.
  it.each([
    ['unrestricted', 'Unrestricted'],
    ['optimized', 'Optimized'],
  ] as const)('%s on air: disabled, with "After the broadcast" and no path', (value, word) => {
    const open = vi.fn();
    mode(value, true, open);
    const row = screen.getByRole('button', { name: `Battery · ${word} · After the broadcast` });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText('Battery → Unrestricted')).toBeNull();
    fireEvent.click(row);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(LANGS)('reads in %s, from the dictionary', async (lang: Lang) => {
    const { t } = createTranslator(lang);
    renderWithPorts(<BatteryRow mode="optimized" held={false} open={vi.fn()} />, {
      kvSeed: { [STORE_KEYS.lang]: lang },
    });
    await act(async () => undefined); // the saved pick is read from the store
    const name = [
      t('settings.battery.label'),
      t('settings.power.optimized'),
      t('settings.power.path'),
    ].join(' · ');
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });
});

describe('ShareRecordRow', () => {
  it('shares the whole record on a press, and says so when the share sheet refuses', async () => {
    const view = renderWithPorts(<ShareRecordRow />);
    act(() => view.ports.logger.info('probe.line', { count: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await settle();
    expect(view.share.shared).toHaveLength(1);
    view.share.refuse();
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await settle();
    expect(screen.getByRole('button', { name: "Couldn't share. Retry" })).toBeTruthy();
  });
});

describe('SendRecordRow: Send record to Seazn', () => {
  /** Made up (AGENTS §13): belongs to no code. */
  const CREDENTIAL: UploadCredential = {
    codeUrl: 'https://x/api/v1/capture/codes/c',
    token: 'made-up-token',
    expiresAtMs: null,
  };
  const send = (name: string | RegExp = /^Send record to Seazn/) =>
    screen.getByRole('button', { name });

  async function withCode(lang: Lang = 'en') {
    const upload = createFakeRecordUpload();
    const view = renderWithPorts(<SendRecordRow />, {
      uploadCredential: createFakeUploadCredential(CREDENTIAL),
      recordUpload: upload,
      deviceLanguages: [lang],
    });
    await settle();
    return { view, upload };
  }

  it('with no code: disabled, and the one helper line says to scan (an empty input)', async () => {
    const view = renderWithPorts(<SendRecordRow />);
    await settle();
    const row = send('Send record to Seazn · Scan a stream code first');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    await settle();
    expect(view.recordUpload.calls).toBe(0);
  });

  it('with a code: enabled with no helper; Sending…, then the ref; one upload', async () => {
    const { upload } = await withCode();
    expect(send('Send record to Seazn').getAttribute('aria-disabled')).toBeNull();
    upload.hold();
    fireEvent.click(send('Send record to Seazn'));
    await settle();
    expect(send('Sending…').getAttribute('aria-disabled')).toBe('true');
    // A second tap while it is out starts no second upload.
    fireEvent.click(send('Sending…'));
    upload.release();
    await settle();
    expect(send('Sent · ref R-TEST')).toBeTruthy();
    expect(upload.calls).toBe(1);
  });

  it('a failed send says so on the row, which stays enabled for another try', async () => {
    const { upload } = await withCode();
    upload.answer({ result: 'failed', ref: null, status: 500, bytes: 1 });
    fireEvent.click(send('Send record to Seazn'));
    await settle();
    const failed = send("Couldn't send — try again");
    expect(failed.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(failed);
    await settle();
    expect(upload.calls).toBe(2);
  });

  it('a failure another try cannot change says why, as the row’s one helper line', async () => {
    const { upload } = await withCode();
    upload.answer({ result: 'too-large', ref: null, status: 413, bytes: 1 });
    fireEvent.click(send('Send record to Seazn'));
    await settle();
    expect(send("Can't send this record · Too big to send — use Share record")).toBeTruthy();
  });

  // Minor 8 of the Batch 6 review (the controller's ruling, 2026-10-12): from Arming on, Send is disabled with its reason.
  const HELD: readonly FakeScene[] = ['arming-retrying', 'connecting', 'live', 'holding'];
  it.each(HELD)('%s: disabled with the reason, and no upload starts', async (scene) => {
    const { view, upload } = await withCode();
    act(() => view.engine.scene(scene));
    const row = send('Send record to Seazn · Send it after the broadcast');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    await settle();
    expect(upload.calls).toBe(0);
  });

  it.each(['pairing', 'paired-ready', 'stopped'] as const)('%s: Send works', async (scene) => {
    const { view, upload } = await withCode();
    act(() => view.engine.scene(scene));
    fireEvent.click(send('Send record to Seazn'));
    await settle();
    expect(upload.calls).toBe(1);
  });

  it('says one thing at a time: on air before no code', async () => {
    const view = renderWithPorts(<SendRecordRow />);
    await settle();
    act(() => view.engine.scene('live'));
    expect(send('Send record to Seazn · Send it after the broadcast')).toBeTruthy();
  });

  it.each(LANGS)('reads its name and its reason in %s, from the dictionary', async (lang) => {
    const { t } = createTranslator(lang);
    const { view } = await withCode(lang);
    act(() => view.engine.scene('live'));
    expect(send(`${t('record.send')} · ${t('record.onAir')}`)).toBeTruthy();
  });
});
