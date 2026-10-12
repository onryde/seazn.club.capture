import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { LANGS } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';
import { RecordRow } from '@/ui/components/RecordRow';
import { createFakeRecordUpload, createFakeUploadCredential } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

/** Made up (AGENTS §13): belongs to no code. */
const CREDENTIAL: UploadCredential = {
  codeUrl: 'https://x/api/v1/capture/codes/c',
  token: 'made-up-token',
  expiresAtMs: null,
};

const sendButton = (name: string | RegExp = 'Send record to Seazn') =>
  screen.getByRole('button', { name });

async function withCode(lang: (typeof LANGS)[number] = 'en') {
  const upload = createFakeRecordUpload();
  const view = renderWithPorts(<RecordRow send />, {
    uploadCredential: createFakeUploadCredential(CREDENTIAL),
    recordUpload: upload,
    deviceLanguages: [lang],
  });
  await settle();
  return { view, upload };
}

describe('the record row (N33, R3)', () => {
  it('Share record alone while the switch is off', async () => {
    renderWithPorts(<RecordRow send={false} />, {
      uploadCredential: createFakeUploadCredential(CREDENTIAL),
    });
    await settle();
    expect(screen.getByRole('button', { name: 'Share record' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send record to Seazn' })).toBeNull();
    expect(screen.queryByText('Scan a stream code first')).toBeNull();
  });

  it('shares the record from the row', async () => {
    const view = renderWithPorts(<RecordRow send={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await settle();
    expect(view.share.shared).toHaveLength(1);
  });

  it('with the switch on and no code: Send is disabled, with one line why (an empty input)', async () => {
    const view = renderWithPorts(<RecordRow send />);
    await settle();
    const button = sendButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Scan a stream code first')).toBeTruthy();
    fireEvent.click(button);
    await settle();
    expect(view.recordUpload.calls).toBe(0);
  });

  it('with a code: Send is enabled with no reason line, and reads Sending…, then the ref', async () => {
    const { upload } = await withCode();
    expect(sendButton().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Scan a stream code first')).toBeNull();
    upload.hold();
    fireEvent.click(sendButton());
    await settle();
    expect(sendButton('Sending…').getAttribute('aria-disabled')).toBe('true');
    upload.release();
    await settle();
    expect(sendButton('Sent · ref R-TEST')).toBeTruthy();
    expect(upload.calls).toBe(1);
  });

  it('a failed send says so on the button, which stays enabled for another try', async () => {
    const { upload } = await withCode();
    upload.answer({ result: 'failed', ref: null, status: 500, bytes: 1 });
    fireEvent.click(sendButton());
    await settle();
    const failed = sendButton("Couldn't send — try again");
    expect(failed.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(failed);
    await settle();
    expect(upload.calls).toBe(2);
  });

  it('reads in Spanish (another language)', async () => {
    await withCode('es');
    expect(screen.getByRole('button', { name: 'Compartir registro' })).toBeTruthy();
    expect(sendButton('Enviar registro a Seazn')).toBeTruthy();
  });

  // P11 (the D3 fixes plan's ruling, the controller's): stacked, so each label has the column's width.
  it('stacks Share record over Send record, each hugging its label at the column’s start', async () => {
    await withCode();
    const row = screen.getByTestId('record-row');
    expect(getComputedStyle(row).flexDirection).toBe('column');
    expect(getComputedStyle(row).alignItems).toBe('flex-start');
    const share = screen.getByRole('button', { name: 'Share record' });
    expect(share.compareDocumentPosition(sendButton())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each(LANGS)('every state’s label reads in %s', (lang) => {
    const { t } = createTranslator(lang);
    for (const key of [
      'record.send',
      'record.sending',
      'record.sendFailed',
      'record.needsCode',
    ] as const)
      expect(t(key)).not.toBe(key);
    expect(t('record.sent', { ref: 'R-7K2Q' })).toContain('R-7K2Q');
  });
});
