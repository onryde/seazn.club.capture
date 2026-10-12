import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { createRecordSendFlight } from '@/services/recordSendFlight';
import { createRingRecord } from '@/services/sessionRecord';
import { createFakeRecordUpload, createFakeUploadCredential } from '../../test/fakePorts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(10);

/** Made up (AGENTS §13): belongs to no code. */
const CREDENTIAL: UploadCredential = {
  codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn',
  token: 'made-up-token',
  expiresAtMs: null,
};

function rig(credential: UploadCredential | null = CREDENTIAL) {
  const credentials = createFakeUploadCredential(credential);
  const upload = createFakeRecordUpload();
  const record = createRingRecord();
  const flight = createRecordSendFlight({ credentials, upload, record });
  return { credentials, upload, record, flight };
}

// Important 3 of the Batch 6 review: the request lives in the ports, built once, so a rotation or a way out and back
// (which remount the row) neither loses the ref nor lets a second upload start.
describe('the record send flight (R3)', () => {
  it('knows nothing of the credential until it is read, then says whether one is in hand', async () => {
    const r = rig();
    expect(r.flight.getSnapshot()).toEqual({ state: { kind: 'idle' }, available: null });
    r.flight.refresh();
    await settle();
    expect(r.flight.getSnapshot().available).toBe(true);
    r.credentials.give(null);
    r.flight.refresh();
    await settle();
    expect(r.flight.getSnapshot().available).toBe(false);
  });

  it('sends once while a send is in flight, tells its subscribers, and keeps the ref after', async () => {
    const r = rig();
    const heard = vi.fn();
    const off = r.flight.subscribe(heard);
    r.upload.hold();
    r.flight.send();
    r.flight.send();
    await settle();
    r.flight.send();
    expect(r.upload.calls).toBe(1);
    expect(r.flight.getSnapshot().state).toEqual({ kind: 'sending' });
    r.upload.release();
    await settle();
    expect(r.flight.getSnapshot().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
    expect(heard).toHaveBeenCalled();
    off();
    heard.mockClear();
    r.flight.send();
    await settle();
    expect(heard).not.toHaveBeenCalled();
    expect(r.upload.calls).toBe(2);
  });

  it('a credential gone by the send sends nothing, and says none is in hand', async () => {
    const r = rig(null);
    r.flight.send();
    await settle();
    expect(r.upload.calls).toBe(0);
    expect(r.flight.getSnapshot()).toEqual({ state: { kind: 'idle' }, available: false });
  });

  it('a send that throws is failed, and the next one goes', async () => {
    const r = rig();
    vi.spyOn(r.upload, 'send').mockRejectedValueOnce(new Error('broken port'));
    r.flight.send();
    await settle();
    expect(r.flight.getSnapshot().state).toEqual({ kind: 'failed' });
    r.flight.send();
    await settle();
    expect(r.flight.getSnapshot().state).toEqual({ kind: 'sent', ref: 'R-TEST' });
  });
});
