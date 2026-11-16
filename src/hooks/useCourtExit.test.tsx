import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import type { SessionState } from '@/domain/session/SessionState';
import { useCourtExit } from '@/hooks/useCourtExit';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedCourtCode, savedStreamCode } from '../../test/fixtures/savedStream';
import { holdIntents } from '../../test/holdIntents';
import { pairCode } from '../../test/pairCode';
import { refusingStore } from '../../test/refusingStore';
import { wrapperFor } from '../../test/renderWithPorts';

type Kind = SessionState['kind'];
const KINDS: readonly Kind[] = [
  'idle',
  'pairing',
  'paired',
  'arming',
  'armed',
  'connecting',
  'publishing',
  'degraded',
  'reconnecting',
  'ended',
];

// Court stream (spec 2026-11-14 §6.4, O5, O12): Exit leaves a court from its waiting screen, asking first. Written from
// the brief: it is offered on a court code while paired, a Leave unpairs, forgets the code and goes Home, and an engine
// that arms closes the question and never unpairs.
const seed = (saved = savedCourtCode()) => ({
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
});

async function mount(
  court: string | null,
  kind: Kind,
  overrides: Parameters<typeof createFakePorts>[0] = {},
) {
  const fakes = createFakePorts({ kvSeed: seed(), ...overrides });
  pairCode(fakes.engine, savedCourtCode());
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  const props = { court, kind };
  const hook = renderHook(
    (p: { court: string | null; kind: Kind }) => useCourtExit(p.court, p.kind),
    {
      wrapper: wrapperFor(fakes),
      initialProps: props,
    },
  );
  return { fakes, hook };
}
const unpairs = (fakes: FakePorts) => fakes.engine.intents.filter((i) => i.kind === 'unpair');
const flush = () => act(() => vi.advanceTimersByTimeAsync(10));

describe('useCourtExit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('offers Exit on a court code while paired, and in no other state or code', async () => {
    const offered: Kind[] = [];
    for (const kind of KINDS) {
      const { hook } = await mount('Court 2', kind);
      if (hook.result.current.offered) offered.push(kind);
      hook.unmount();
    }
    expect(offered).toEqual(['paired']);
    const { hook } = await mount(null, 'paired');
    expect(hook.result.current.offered).toBe(false);
    act(() => hook.result.current.ask());
    expect(hook.result.current.open).toBe(false);
  });

  it('asks, stays and asks twice', async () => {
    const { hook } = await mount('Court 2', 'paired');
    expect(hook.result.current.open).toBe(false);
    act(() => hook.result.current.ask());
    act(() => hook.result.current.ask());
    expect(hook.result.current.open).toBe(true);
    act(() => hook.result.current.stay());
    expect(hook.result.current.open).toBe(false);
  });

  // Review Focus 4: a remote Go live arrives while the question is open.
  it('closes when the engine arms, and never unpairs; the question does not come back after the match', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    act(() => hook.result.current.ask());
    expect(hook.result.current.open).toBe(true);
    hook.rerender({ court: 'Court 2', kind: 'arming' });
    expect(hook.result.current.open).toBe(false);
    expect(unpairs(fakes)).toEqual([]);
    // After an interruption: the match ends and the court is waiting again. The old question is not still open.
    hook.rerender({ court: 'Court 2', kind: 'paired' });
    expect(hook.result.current.open).toBe(false);
    expect(unpairs(fakes)).toEqual([]);
  });

  it('leaves: unpairs, forgets the saved code, then goes Home', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    act(() => hook.result.current.ask());
    act(() => hook.result.current.leave());
    await flush();
    expect(unpairs(fakes)).toHaveLength(1);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(fakes.navigation.current()).toBe('home');
    expect(hook.result.current.open).toBe(false);
  });

  it('sends one unpair for two Leaves, one under way (a second call)', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    const native = holdIntents(fakes.engine, ['unpair']);
    act(() => hook.result.current.leave());
    act(() => hook.result.current.leave());
    await flush();
    expect(native.held()).toEqual(['unpair']);
    act(() => native.release());
    await flush();
    expect(unpairs(fakes)).toHaveLength(1);
  });

  // C4b-I2: the code on screen when Leave was pressed. A code scanned while the unpair is under way is a new scan, which
  // the forget leaves, and Leave does not follow it Home.
  it('leaves a code scanned while the unpair was under way, and stays', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    const native = holdIntents(fakes.engine, ['unpair']);
    act(() => hook.result.current.leave());
    await flush();
    await act(() => fakes.ports.modeStore.open(savedStreamCode()));
    act(() => native.release());
    await flush();
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(fakes.navigation.current()).toBe('stream');
  });

  // An empty input: nothing saved.
  it('does nothing when no code is saved, and closes the question', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired', { kvSeed: {} });
    act(() => hook.result.current.ask());
    act(() => hook.result.current.leave());
    await flush();
    expect(hook.result.current.open).toBe(false);
    expect(unpairs(fakes)).toEqual([]);
    expect(fakes.navigation.current()).toBe('stream');
  });

  // The amendment: a remote Go live that raced the tap stands, and so does its code.
  it('keeps the code and stays when a Go live won the race', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    act(() => fakes.engine.hear({ word: 'go-live', cause: 'organiser' }));
    act(() => hook.result.current.leave());
    await flush();
    expect(unpairs(fakes)).toEqual([]);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(fakes.navigation.current()).toBe('stream');
  });

  describe('a refused forget', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => process.off('unhandledRejection', onRejection));

    it('stays on Live Stream, keeps the code and says so in the record', async () => {
      const store = refusingStore(seed(), (key) => key === STORE_KEYS.code('stream'));
      const { fakes, hook } = await mount('Court 2', 'paired', { modeStore: store, kvSeed: {} });
      act(() => hook.result.current.leave());
      await flush();
      const refused = readRecord(fakes.record).filter(
        (line) => line.event === 'store.write-refused',
      );
      expect(refused).toEqual([
        expect.objectContaining({ level: 'warn', fields: { action: 'court-leave' } }),
      ]);
      expect(fakes.navigation.current()).toBe('stream');
      expect(rejections).toEqual([]);
    });
  });

  it('is a fixture code’s: no Exit, and a saved fixture code is untouched', async () => {
    const { fakes, hook } = await mount(null, 'paired', { kvSeed: seed(savedStreamCode()) });
    expect(hook.result.current.offered).toBe(false);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });
});
