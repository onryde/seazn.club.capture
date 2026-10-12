import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { useRecordSend } from '@/hooks/useRecordSend';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

/** Made up (AGENTS §13): belongs to no code. */
const CREDENTIAL: UploadCredential = {
  codeUrl: 'https://x/api/v1/capture/codes/c',
  token: 'made-up-token',
  expiresAtMs: null,
};

async function mounted(credential: UploadCredential | null = CREDENTIAL) {
  const fakes = createFakePorts();
  fakes.uploadCredential.give(credential);
  const view = renderHook(() => useRecordSend(), { wrapper: wrapperFor(fakes) });
  await settle();
  return { fakes, view, now: () => view.result.current };
}

/** The row mounted again on the same ports, as a rotation or a way out and back does. */
async function remounted(hook: Awaited<ReturnType<typeof mounted>>) {
  hook.view.unmount();
  const view = renderHook(() => useRecordSend(), { wrapper: wrapperFor(hook.fakes) });
  await settle();
  return { ...hook, view, now: () => view.result.current };
}

const send = (hook: { now: () => ReturnType<typeof useRecordSend> }) =>
  act(() => hook.now().send());

describe('Send record (R3)', () => {
  it('is unavailable with no credential, and says so (an empty input)', async () => {
    const hook = await mounted(null);
    expect(hook.now().available).toBe(false);
    expect(hook.now().state).toEqual({ kind: 'idle' });
  });

  // Minor 7 of the Batch 6 review: before the keystore answers, it is not known, so no reason line flashes.
  it('is not known before the first read answers', () => {
    const fakes = createFakePorts();
    fakes.uploadCredential.give(CREDENTIAL);
    const view = renderHook(() => useRecordSend(), { wrapper: wrapperFor(fakes) });
    expect(view.result.current.available).toBeNull();
  });

  it('is available with a credential, and idle', async () => {
    const hook = await mounted();
    expect(hook.now().available).toBe(true);
    expect(hook.now().state).toEqual({ kind: 'idle' });
  });

  it('sends once on a double tap, then shows the ref', async () => {
    const hook = await mounted();
    act(() => {
      hook.now().send();
      hook.now().send();
    });
    expect(hook.now().state.kind).toBe('sending');
    await settle();
    expect(hook.fakes.recordUpload.calls).toBe(1);
    expect(hook.now().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
  });

  it('ignores a tap while a send is in flight, and takes the next one after it', async () => {
    const hook = await mounted();
    hook.fakes.recordUpload.hold();
    await send(hook);
    await settle();
    await send(hook);
    await settle();
    expect(hook.fakes.recordUpload.calls).toBe(1);
    expect(hook.now().state.kind).toBe('sending');
    hook.fakes.recordUpload.release();
    await settle();
    expect(hook.now().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
    await send(hook);
    await settle();
    expect(hook.fakes.recordUpload.calls).toBe(2);
  });

  // R9 (the controller's): one record and one truth. What Send sends is what Share shares: the JS ring, whole.
  it('sends the record Share would share, with the credential’s token', async () => {
    const hook = await mounted();
    hook.fakes.ports.logger.info('probe.line', { count: 1 });
    const lines = hook.fakes.record.lines();
    await send(hook);
    await settle();
    expect(hook.fakes.recordUpload.sent[0]).toEqual({ lines, token: CREDENTIAL.token });
  });

  it.each([
    ['failed', 500],
    ['unauthorised', 401],
    ['too-large', 413],
    ['rate-limited', 429],
    ['refused-local', null],
  ] as const)(
    'a send answered %s says it failed, and can be tried again',
    async (result, status) => {
      const hook = await mounted();
      hook.fakes.recordUpload.answer({ result, ref: null, status, bytes: 1 });
      await send(hook);
      await settle();
      expect(hook.now().state).toEqual({ kind: 'failed' });
      await send(hook);
      await settle();
      expect(hook.fakes.recordUpload.calls).toBe(2);
    },
  );

  // The port pairs them (a 201 with a valid ref, and nothing else, is sent); the button reads both, so neither alone
  // can show a ref that is not there or call a refusal sent.
  it.each([
    ['sent with no ref', { result: 'sent', ref: null }],
    ['a refusal carrying a ref', { result: 'failed', ref: 'R-STRAY' }],
  ] as const)('an answer of %s says it failed', async (_name, answer) => {
    const hook = await mounted();
    hook.fakes.recordUpload.answer({ ...answer, status: 201, bytes: 1 });
    await send(hook);
    await settle();
    expect(hook.now().state).toEqual({ kind: 'failed' });
  });

  // Preflight N13: the port promises never to reject; if it ever did, the button must not stay on Sending… for good.
  it('a send that throws says it failed, and can be tried again', async () => {
    const hook = await mounted();
    vi.spyOn(hook.fakes.recordUpload, 'send').mockRejectedValueOnce(new Error('broken port'));
    await send(hook);
    await settle();
    expect(hook.now().state).toEqual({ kind: 'failed' });
    await send(hook);
    await settle();
    expect(hook.now().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
  });

  // After an interruption: the 24 h can run out between the read at mount and the tap.
  it('a credential gone by the tap sends nothing, and turns the button off with its reason', async () => {
    const hook = await mounted();
    hook.fakes.uploadCredential.give(null);
    await send(hook);
    await settle();
    expect(hook.fakes.recordUpload.calls).toBe(0);
    expect(hook.now()).toMatchObject({ available: false, state: { kind: 'idle' } });
  });

  it('reads the credential again on the return to the foreground (it may have expired in a pocket)', async () => {
    const hook = await mounted();
    hook.fakes.uploadCredential.give(null);
    act(() => hook.fakes.foreground.fire());
    await settle();
    expect(hook.now().available).toBe(false);
    hook.fakes.uploadCredential.give(CREDENTIAL);
    act(() => hook.fakes.foreground.fire());
    await settle();
    expect(hook.now().available).toBe(true);
  });

  it('stops listening for the foreground when it unmounts', async () => {
    const hook = await mounted();
    const listening = hook.fakes.foreground.returnListeners();
    hook.view.unmount();
    expect(hook.fakes.foreground.returnListeners()).toBe(listening - 1);
  });

  // "Throws nothing" rests on vitest failing the run on an unhandled rejection (Minor 12 of the Batch 6 review).
  it('a send that lands after the row has gone throws nothing', async () => {
    const hook = await mounted();
    hook.fakes.recordUpload.hold();
    await send(hook);
    hook.view.unmount();
    hook.fakes.recordUpload.release();
    await settle();
    expect(hook.fakes.recordUpload.calls).toBe(1);
  });

  // Important 3 of the Batch 6 review: a rotation, or Back and in again, remounts the row; the request is the ports'.
  it('a row mounted again mid-send reads Sending…, and a tap there makes no second call', async () => {
    const hook = await mounted();
    hook.fakes.recordUpload.hold();
    await send(hook);
    const again = await remounted(hook);
    expect(again.now().state).toEqual({ kind: 'sending' });
    await send(again);
    await settle();
    expect(again.fakes.recordUpload.calls).toBe(1);
    again.fakes.recordUpload.release();
    await settle();
    expect(again.now().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
  });

  it('a row mounted again after the send still shows the ref', async () => {
    const hook = await mounted();
    await send(hook);
    await settle();
    const again = await remounted(hook);
    expect(again.now().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
  });
});
