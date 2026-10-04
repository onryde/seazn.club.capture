import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDisarm } from '@/hooks/useDisarm';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { holdIntents } from '../../test/holdIntents';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const pair = (fakes: FakePorts) => pairCode(fakes.engine, savedStreamCode());
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);

function disarmer(fakes: FakePorts) {
  return renderHook(() => useDisarm(), { wrapper: wrapperFor(fakes) });
}

/** I1 (final review): a pairing no saved code owns is cleared by native's own path. */
describe('useDisarm', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('unpairs a paired engine, and sends nothing more once it is idle', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(readRecord(fakes.record).map(({ event, fields }) => ({ event, fields }))).toEqual([
      { event: 'intent.unpair', fields: { action: 'forget' } },
    ]);
  });

  // An organiser's stop returns to Paired now (amendment), so it is unpaired like any pairing.
  it('unpairs a pairing back from an organiser’s stop', () => {
    const fakes = createFakePorts();
    fakes.engine.scene('paired-after-organiser-stop');
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['unpair']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
  });

  it.each(['stopped', 'fatal'] as const)('resets a %s engine, and never unpairs it', (scene) => {
    const fakes = createFakePorts();
    fakes.engine.scene(scene);
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['reset']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('never touches a broadcast, nor what follows it', () => {
    const fakes = createFakePorts();
    fakes.engine.scene('live');
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    act(() => fakes.engine.scene('stopped'));
    expect(kinds(fakes)).toEqual([]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
  });

  it('sends nothing at idle, and nothing to the next pairing', () => {
    const fakes = createFakePorts();
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    act(() => pair(fakes));
    expect(kinds(fakes)).toEqual(['pair']);
  });

  it('asks once per status: reports while the unpair is unanswered send nothing more', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const native = holdIntents(fakes.engine, ['unpair']);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    // The fake reports once a second, changed or not, as native does.
    act(() => vi.advanceTimersByTime(2500));
    expect(native.held()).toEqual(['unpair']);
    act(() => native.release());
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
  });

  it('stops listening on unmount', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const native = holdIntents(fakes.engine, ['unpair']);
    const { result, unmount } = disarmer(fakes);
    act(() => result.current('forget'));
    unmount();
    act(() => native.release());
    // One step now (paired → unpair → idle), so this pins only that nothing follows the unmount.
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
  });

  // A second call, both ways: dropped while one is under way, run once it has ended.
  it('drops a call while one is under way, and runs the next one after', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const native = holdIntents(fakes.engine, ['unpair']);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    act(() => result.current('forget'));
    expect(native.held()).toEqual(['unpair']);
    act(() => native.release());
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
    act(() => pair(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['pair', 'unpair', 'pair', 'unpair']);
  });

  // Final fix round 2, M-d: Forget and the reopen gate are two callers of one
  // clearing. A foreground while Forget's stop is unanswered sends no second stop.
  describe('one clearing per engine, whoever asks', () => {
    it('drops another caller while one is under way', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      act(() => gate.result.current('orphan'));
      expect(native.held()).toEqual(['unpair']);
      act(() => native.release());
      expect(kinds(fakes)).toEqual(['pair', 'unpair']);
      expect(readRecord(fakes.record).map(({ event, fields }) => ({ event, fields }))).toEqual([
        { event: 'intent.unpair', fields: { action: 'forget' } },
      ]);
    });

    it('lets another caller run once it has ended', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      act(() => pair(fakes));
      act(() => gate.result.current('orphan'));
      expect(kinds(fakes)).toEqual(['pair', 'unpair', 'pair', 'unpair']);
    });

    it('is not ended by another caller unmounting', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      gate.unmount();
      act(() => native.release());
      expect(kinds(fakes)).toEqual(['pair', 'unpair']);
    });

    it('frees the engine when its owner unmounts, so the next caller can clear it', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      forget.unmount();
      act(() => native.release());
      expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
      act(() => pair(fakes));
      act(() => gate.result.current('orphan'));
      expect(kinds(fakes)).toEqual(['pair', 'unpair', 'pair', 'unpair']);
      expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    });

    it('never frees a later clearing when a caller that already finished unmounts', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      const third = disarmer(fakes);
      // Forget's clearing ends after it returned: native answers its unpair later.
      const first = holdIntents(fakes.engine, ['unpair']);
      act(() => forget.result.current('forget'));
      act(() => first.release());
      act(() => pair(fakes));
      const native = holdIntents(fakes.engine, ['unpair']);
      act(() => gate.result.current('orphan'));
      forget.unmount();
      act(() => third.result.current('orphan'));
      expect(native.held()).toEqual(['unpair']);
    });

    it('keeps engines apart: a clearing on one never blocks another', () => {
      const one = createFakePorts();
      const two = createFakePorts();
      pair(one);
      pair(two);
      holdIntents(one.engine, ['unpair']);
      const first = disarmer(one);
      const second = disarmer(two);
      act(() => first.result.current('forget'));
      act(() => second.result.current('forget'));
      expect(kinds(two)).toEqual(['pair', 'unpair']);
    });
  });

  it('runs again after one that found nothing to clear', () => {
    const fakes = createFakePorts();
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    act(() => pair(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
  });
});
