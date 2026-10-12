import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { LANGS } from '@/i18n/language';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
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

  // R1-1 of the Batch 6 re-review: a new scan brings a new code, and the last code's ref goes with the old one.
  it('after a send, a return with another code in hand reads Send record to Seazn again', async () => {
    const credential = createFakeUploadCredential(CREDENTIAL);
    const view = renderWithPorts(<RecordRow send />, { uploadCredential: credential });
    await settle();
    fireEvent.click(sendButton());
    await settle();
    expect(sendButton('Sent · ref R-TEST')).toBeTruthy();
    credential.give({ ...CREDENTIAL, codeUrl: CREDENTIAL.codeUrl.replace('/codes/c', '/codes/d') });
    act(() => view.foreground.fire());
    await settle();
    expect(sendButton().getAttribute('aria-disabled')).toBeNull();
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

  // Fix round 1 of Batch 11 (the controller's ruling 8): a failure another try cannot change (401, 404, 413, a contract
  // mismatch) reads "Can't send this record" and why, with no "try again"; one it can (the network, a timeout, 429, a
  // 5xx) keeps "try again", with no reason. The classes are the ruling's; the words are the dictionary's.
  const { t: en } = createTranslator('en');
  it.each([
    ['the network or a timeout', 'failed', null, 'record.sendFailed', null],
    ['a 5xx', 'failed', 503, 'record.sendFailed', null],
    ['429', 'rate-limited', 429, 'record.sendFailed', null],
    ['401', 'unauthorised', 401, 'record.cantSend', 'record.cant.ended'],
    ['404', 'not-found', 404, 'record.cantSend', 'record.cant.notFound'],
    ['413', 'too-large', 413, 'record.cantSend', 'record.cant.tooLarge'],
    ['422', 'invalid', 422, 'record.cantSend', 'record.cant.mismatch'],
    ['a 201 off the contract', 'unreadable', 201, 'record.cantSend', 'record.cant.mismatch'],
    ['a record refused here', 'refused-local', null, 'record.cantSend', 'record.cant.mismatch'],
  ] as const)('%s reads its own words', async (_name, result, status, label, reason) => {
    const { upload } = await withCode();
    upload.answer({ result, ref: null, status, bytes: 1 });
    fireEvent.click(sendButton());
    await settle();
    const button = sendButton(en(label));
    expect(button.getAttribute('aria-disabled')).toBeNull();
    const reasons = [...screen.getByTestId('record-row').children].slice(2);
    expect(reasons.map((line) => line.textContent)).toEqual(reason === null ? [] : [en(reason)]);
    if (reason !== null) expect(en(label)).not.toMatch(/try again/i);
  });

  it('a permanent failure reads in French, its reason too (another language)', async () => {
    const { upload } = await withCode('fr');
    const { t } = createTranslator('fr');
    upload.answer({ result: 'too-large', ref: null, status: 413, bytes: 1 });
    fireEvent.click(sendButton(t('record.send')));
    await settle();
    expect(sendButton(t('record.cantSend'))).toBeTruthy();
    expect(screen.getByText(t('record.cant.tooLarge'))).toBeTruthy();
  });

  // Minor 7 of the Batch 6 review: the keystore's first answer has not come, so the row says nothing yet.
  it('with a code, draws no reason line before the first read answers', () => {
    renderWithPorts(<RecordRow send />, {
      uploadCredential: createFakeUploadCredential(CREDENTIAL),
    });
    expect(screen.queryByText('Scan a stream code first')).toBeNull();
    expect(sendButton().getAttribute('aria-disabled')).toBe('true');
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
      'record.cantSend',
      'record.cant.ended',
      'record.cant.notFound',
      'record.cant.tooLarge',
      'record.cant.mismatch',
      'record.needsCode',
      'record.onAir',
    ] as const)
      expect(t(key)).not.toBe(key);
    expect(t('record.sent', { ref: 'R-7K2Q' })).toContain('R-7K2Q');
  });
});

// Minor 8 of the Batch 6 review (the controller's ruling, 2026-10-12): up to 1 MB must not ride the broadcast's
// uplink. From Arming on, Send is disabled with its reason, as the battery row's App settings is (AGENTS §6); Share
// record stays: it is local and uses no uplink.
describe('the record row on air (Minor 8)', () => {
  const HELD: readonly FakeScene[] = ['arming-retrying', 'connecting', 'live', 'holding'];
  it.each(HELD)('%s: Send is disabled and says why, Share still works', async (scene) => {
    const { view, upload } = await withCode();
    act(() => view.engine.scene(scene));
    expect(sendButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Send it after the broadcast')).toBeTruthy();
    fireEvent.click(sendButton());
    await settle();
    expect(upload.calls).toBe(0);
    const share = screen.getByRole('button', { name: 'Share record' });
    expect(share.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(share);
    await settle();
    expect(view.share.shared).toHaveLength(1);
  });

  const FREE: readonly FakeScene[] = ['pairing', 'paired-ready', 'stopped'];
  it.each(FREE)('%s: Send works, with no reason', async (scene) => {
    const { view, upload } = await withCode();
    act(() => view.engine.scene(scene));
    expect(screen.queryByText('Send it after the broadcast')).toBeNull();
    fireEvent.click(sendButton());
    await settle();
    expect(upload.calls).toBe(1);
  });

  it('says one thing at a time: on air before no code', async () => {
    const view = renderWithPorts(<RecordRow send />);
    await settle();
    act(() => view.engine.scene('live'));
    expect(screen.getByText('Send it after the broadcast')).toBeTruthy();
    expect(screen.queryByText('Scan a stream code first')).toBeNull();
  });

  it('says why in French', async () => {
    const { view } = await withCode('fr');
    act(() => view.engine.scene('live'));
    expect(screen.getByText(createTranslator('fr').t('record.onAir'))).toBeTruthy();
  });
});
