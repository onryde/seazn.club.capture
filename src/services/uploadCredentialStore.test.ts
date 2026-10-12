import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCredential,
  encodeCredential,
  KEEP_AFTER_DROP_MS,
} from '@/domain/credentials/uploadCredential';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createRingRecord } from '@/services/sessionRecord';
import {
  createUploadCredentialStore,
  UPLOAD_CREDENTIAL_KEY,
} from '@/services/uploadCredentialStore';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { captureRaw, FIXTURE_TOKEN } from '../../test/fixtures/wire';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const START = new Date('2026-10-12T10:00:00Z');
/** Another camera position's code (made up): another token. */
const OTHER_TOKEN = 'tok-other-000000000000';
const other = savedStreamCode({ raw: captureRaw({ slot: 2, tok: OTHER_TOKEN }), slot: 2 });

function rig(options: { enabled?: boolean; seed?: Record<string, string> } = {}) {
  let now = START;
  const code = savedStreamCode();
  const kv = createMemoryKeyValueStore(
    options.seed ?? { [STORE_KEYS.code('stream')]: encodeSavedCode(code) },
  );
  const modeStore = createModeStore(kv);
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => now.getTime() });
  const store = createUploadCredentialStore({
    kv,
    modeStore,
    clock: () => now,
    logger,
    enabled: options.enabled ?? true,
  });
  const stored = () => decodeCredential(kv.entries.get(UPLOAD_CREDENTIAL_KEY) ?? '');
  /** The code as the store holds it: `forget` matches the scan it was handed, by identity. */
  const held = () => {
    const snapshot = modeStore.getSnapshot();
    const saved = snapshot.status === 'ready' ? snapshot.saved.codes.stream : undefined;
    if (saved === undefined) throw new Error('no saved stream code');
    return saved;
  };
  return {
    kv,
    modeStore,
    record,
    store,
    code,
    stored,
    held,
    settle: () => vi.advanceTimersByTimeAsync(10),
    at: (ms: number) => {
      now = new Date(ms);
    },
    now: () => now.getTime(),
  };
}

/** Holds the next write to the credential's key until `release`; every other write goes through. */
function holdNextSet(kv: ReturnType<typeof createMemoryKeyValueStore>) {
  const set = kv.set.bind(kv);
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  vi.spyOn(kv, 'set').mockImplementation(async (key, value) => {
    if (key === UPLOAD_CREDENTIAL_KEY && !held) {
      held = true;
      await gate;
    }
    return set(key, value);
  });
  return { release: () => release() };
}

describe('the upload credential store (R4, P10)', () => {
  it('keeps the saved code’s token, with no expiry, once the store loads', async () => {
    const r = rig();
    expect(r.kv.entries.has(UPLOAD_CREDENTIAL_KEY)).toBe(false); // nothing before the store is ready
    await r.modeStore.load();
    await r.settle();
    expect(r.stored()).toEqual({
      codeUrl: r.code.stream?.codeUrl,
      token: FIXTURE_TOKEN,
      expiresAtMs: null,
    });
    expect(await r.store.current()).toEqual(r.stored());
  });

  it('starts the 24 h when the code is dropped, is usable through them, and is gone after them', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    expect(await r.modeStore.forget(r.held())).toBe(true);
    await r.settle();
    const droppedAt = r.now();
    expect(r.stored()?.expiresAtMs).toBe(droppedAt + KEEP_AFTER_DROP_MS);
    r.at(droppedAt + KEEP_AFTER_DROP_MS - 1);
    expect((await r.store.current())?.token).toBe(FIXTURE_TOKEN);
    r.at(droppedAt + KEEP_AFTER_DROP_MS);
    expect(await r.store.current()).toBeNull();
    await r.settle();
    expect(r.kv.entries.has(UPLOAD_CREDENTIAL_KEY)).toBe(false);
  });

  it('is renewed by a new scan, and the new code’s token replaces the old one', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    await r.modeStore.open(other);
    await r.settle();
    expect(r.stored()).toMatchObject({ token: OTHER_TOKEN, expiresAtMs: null });
  });

  // A second call: a Forget and a new scan in one burst. The writes run in order, so the last word is the new code's.
  it('lands on the new code when a forget and a new scan arrive together', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    void r.modeStore.forget(r.held());
    void r.modeStore.open(other);
    await r.settle();
    expect(r.stored()).toMatchObject({ token: OTHER_TOKEN, expiresAtMs: null });
  });

  it('writes nothing when the saved code already matches (a second publish)', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    const set = vi.spyOn(r.kv, 'set');
    await r.modeStore.setActive('stream');
    await r.settle();
    expect(set.mock.calls.map(([key]) => key)).not.toContain(UPLOAD_CREDENTIAL_KEY);
  });

  // After an interruption: a cold start. Before the saved codes are read, the store knows nothing about them, and a
  // kept credential is not "dropped" by a mode store that is still loading.
  it('does not start the 24 h on a cold start before the saved codes are read', async () => {
    const kept = encodeCredential({
      codeUrl: savedStreamCode().stream?.codeUrl ?? '',
      token: FIXTURE_TOKEN,
      expiresAtMs: null,
    });
    const r = rig({
      seed: {
        [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
        [UPLOAD_CREDENTIAL_KEY]: kept,
      },
    });
    await r.settle();
    expect(r.kv.entries.get(UPLOAD_CREDENTIAL_KEY)).toBe(kept);
  });

  it('answers what a write still in flight is writing', async () => {
    const r = rig();
    const write = holdNextSet(r.kv);
    await r.modeStore.load();
    const answer = r.store.current();
    await r.settle();
    write.release();
    expect((await answer)?.token).toBe(FIXTURE_TOKEN);
  });

  // A second call: a slow keystore write is never overtaken by the next one.
  it('lands on the new code even when the drop’s write is slow', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    const write = holdNextSet(r.kv);
    void r.modeStore.forget(r.held());
    await r.settle();
    void r.modeStore.open(other);
    await r.settle();
    write.release();
    await r.settle();
    expect(r.stored()).toMatchObject({ token: OTHER_TOKEN, expiresAtMs: null });
  });

  it('stores nothing with no saved code, and answers nothing (an empty input)', async () => {
    const r = rig({ seed: {} });
    await r.modeStore.load();
    await r.settle();
    expect(r.kv.entries.has(UPLOAD_CREDENTIAL_KEY)).toBe(false);
    expect(await r.store.current()).toBeNull();
  });

  it('answers nothing for a stored value it cannot read', async () => {
    const r = rig({ seed: { [UPLOAD_CREDENTIAL_KEY]: '{"v":2}' } });
    await r.modeStore.load();
    await r.settle();
    expect(await r.store.current()).toBeNull();
  });

  it('answers nothing, and never rejects, when the store cannot be read', async () => {
    const r = rig();
    await r.modeStore.load();
    await r.settle();
    vi.spyOn(r.kv, 'get').mockRejectedValue(new Error('keystore locked'));
    await expect(r.store.current()).resolves.toBeNull();
  });

  it('stores nothing while the switch is off', async () => {
    const r = rig({ enabled: false });
    await r.modeStore.load();
    await r.settle();
    expect(r.kv.entries.has(UPLOAD_CREDENTIAL_KEY)).toBe(false);
    expect(await r.store.current()).toBeNull();
  });

  // P10: a build with the switch on may have left one; a build with it off holds no token.
  it('deletes a credential left behind when the switch is off', async () => {
    const left = encodeCredential({
      codeUrl: 'https://x',
      token: FIXTURE_TOKEN,
      expiresAtMs: null,
    });
    const r = rig({ enabled: false, seed: { [UPLOAD_CREDENTIAL_KEY]: left } });
    await r.settle();
    expect(r.kv.entries.has(UPLOAD_CREDENTIAL_KEY)).toBe(false);
  });

  it('records a refused write, never throws, and never writes the token into the record', async () => {
    const r = rig();
    vi.spyOn(r.kv, 'set').mockRejectedValue(new Error(`keystore locked ${FIXTURE_TOKEN}`));
    await r.modeStore.load();
    await r.settle();
    const lines = r.record.lines();
    expect(lines.some((l) => l.includes('store.write-refused'))).toBe(true);
    expect(lines.some((l) => l.includes('"action":"upload-credential"'))).toBe(true);
    expect(lines.some((l) => l.includes(FIXTURE_TOKEN))).toBe(false);
    await expect(r.store.current()).resolves.toBeNull();
  });
});
