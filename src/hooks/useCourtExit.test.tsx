import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import type { SessionState } from '@/domain/session/SessionState';
import { useCourtExit } from '@/hooks/useCourtExit';
import { UNPAIR_GIVE_UP_MS, useUnpair } from '@/hooks/useUnpair';
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

  // Whole-branch review I2: `leaving` is how the screen knows to swallow Back, and it must end with the clearing.
  it('is leaving from the Leave until native answers or the 5 s give up, then not', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    expect(hook.result.current.leaving).toBe(false);
    const native = holdIntents(fakes.engine, ['unpair']);
    act(() => hook.result.current.leave());
    await flush();
    expect(hook.result.current.leaving).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(UNPAIR_GIVE_UP_MS));
    expect(hook.result.current.leaving).toBe(false);
    // A second Leave is leaving again, and ends when native answers.
    act(() => hook.result.current.leave());
    await flush();
    expect(hook.result.current.leaving).toBe(true);
    act(() => native.release());
    await flush();
    expect(hook.result.current.leaving).toBe(false);
  });

  it('is never leaving for a Leave another caller’s clearing dropped, or with nothing saved', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    const native = holdIntents(fakes.engine, ['unpair']);
    const other = renderHook(() => useUnpair(), { wrapper: wrapperFor(fakes) });
    act(() => other.result.current('orphan'));
    act(() => hook.result.current.leave());
    await flush();
    expect(hook.result.current.leaving).toBe(false);
    act(() => native.release());
    await flush();
    const empty = await mount('Court 2', 'paired', { kvSeed: {} });
    act(() => empty.hook.result.current.leave());
    await flush();
    expect(empty.hook.result.current.leaving).toBe(false);
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
  // Court stream Task 13 fix round 1: a Leave during the operator's start waits for native's answer (useUnpair), so the
  // Leave is honoured, not dropped at the 5 s give-up with the code kept.
  it('leaves once native answers a start that was in flight: a failed start unpairs, forgets and goes Home', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    fakes.engine.setStartAnswer('hold');
    act(() => fakes.engine.send({ kind: 'start' }));
    act(() => hook.result.current.leave());
    await act(() => vi.advanceTimersByTimeAsync(UNPAIR_GIVE_UP_MS + 1_000));
    expect(unpairs(fakes)).toEqual([]);
    expect(hook.result.current.leaving).toBe(true);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    act(() => fakes.engine.setStartAnswer('failed'));
    await flush();
    expect(unpairs(fakes)).toHaveLength(1);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(fakes.navigation.current()).toBe('home');
    expect(hook.result.current.leaving).toBe(false);
  });

  it('keeps the code and stays when the start it waited for goes live', async () => {
    const { fakes, hook } = await mount('Court 2', 'paired');
    fakes.engine.setStartAnswer('hold');
    act(() => fakes.engine.send({ kind: 'start' }));
    act(() => hook.result.current.leave());
    act(() => fakes.engine.setStartAnswer('started'));
    await flush();
    expect(unpairs(fakes)).toEqual([]);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
    expect(fakes.navigation.current()).toBe('stream');
    expect(hook.result.current.leaving).toBe(false);
  });

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

    it('keeps the code, says so in the record and on Home, and goes Home', async () => {
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
      // Never silent (S0 R19): Home gets the notice, and the code is still saved there to Forget again.
      expect(fakes.ports.homeNews.peek()).toBe('store.saveFailed');
      expect(en['store.saveFailed']).toBe("Couldn't save on this phone. Try again.");
      expect(fakes.navigation.current()).toBe('home');
      expect(rejections).toEqual([]);
    });
  });

  it('is a fixture code’s: no Exit, and a saved fixture code is untouched', async () => {
    const { fakes, hook } = await mount(null, 'paired', { kvSeed: seed(savedStreamCode()) });
    expect(hook.result.current.offered).toBe(false);
    expect(fakes.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });
});
