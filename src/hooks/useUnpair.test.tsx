import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNPAIR_GIVE_UP_MS, useUnpair, type UnpairOutcome } from '@/hooks/useUnpair';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { holdIntents } from '../../test/holdIntents';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const pair = (fakes: FakePorts) => pairCode(fakes.engine, savedStreamCode());
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);

function unpairer(fakes: FakePorts) {
  return renderHook(() => useUnpair(), { wrapper: wrapperFor(fakes) });
}

/** The hook over fresh fake ports, paired first with the fixture code when `paired`. */
function renderUnpair({ paired }: { paired: boolean }) {
  const fakes = createFakePorts();
  if (paired) pair(fakes);
  const { result } = unpairer(fakes);
  return {
    ...fakes,
    unpair: (...args: Parameters<ReturnType<typeof useUnpair>>) => result.current(...args),
  };
}

const events = (fakes: FakePorts) => readRecord(fakes.record).map((entry) => entry.event);

/** I1 (final review): a pairing no saved code owns is cleared by native's own path. */
describe('useUnpair', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('unpairs a paired engine, and sends nothing more once it is idle', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const { result } = unpairer(fakes);
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
    const { result } = unpairer(fakes);
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['unpair']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
  });

  it.each(['stopped', 'fatal'] as const)('resets a %s engine, and never unpairs it', (scene) => {
    const fakes = createFakePorts();
    fakes.engine.scene(scene);
    const { result } = unpairer(fakes);
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['reset']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
  });

  it('never touches a broadcast, nor what follows it', () => {
    const fakes = createFakePorts();
    fakes.engine.scene('live');
    const { result } = unpairer(fakes);
    act(() => result.current('orphan'));
    act(() => fakes.engine.scene('stopped'));
    expect(kinds(fakes)).toEqual([]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
  });

  it('sends nothing at idle, and nothing to the next pairing', () => {
    const fakes = createFakePorts();
    const { result } = unpairer(fakes);
    act(() => result.current('forget'));
    act(() => pair(fakes));
    expect(kinds(fakes)).toEqual(['pair']);
  });

  it('asks once per status: reports while the unpair is unanswered send nothing more', () => {
    const fakes = createFakePorts();
    pair(fakes);
    const native = holdIntents(fakes.engine, ['unpair']);
    const { result } = unpairer(fakes);
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
    const { result, unmount } = unpairer(fakes);
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
    const { result } = unpairer(fakes);
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
      const forget = unpairer(fakes);
      const gate = unpairer(fakes);
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
      const forget = unpairer(fakes);
      const gate = unpairer(fakes);
      act(() => forget.result.current('forget'));
      act(() => pair(fakes));
      act(() => gate.result.current('orphan'));
      expect(kinds(fakes)).toEqual(['pair', 'unpair', 'pair', 'unpair']);
    });

    it('is not ended by another caller unmounting', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const forget = unpairer(fakes);
      const gate = unpairer(fakes);
      act(() => forget.result.current('forget'));
      gate.unmount();
      act(() => native.release());
      expect(kinds(fakes)).toEqual(['pair', 'unpair']);
    });

    it('frees the engine when its owner unmounts, so the next caller can clear it', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const forget = unpairer(fakes);
      const gate = unpairer(fakes);
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
      const forget = unpairer(fakes);
      const gate = unpairer(fakes);
      const third = unpairer(fakes);
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
      const first = unpairer(one);
      const second = unpairer(two);
      act(() => first.result.current('forget'));
      act(() => second.result.current('forget'));
      expect(kinds(two)).toEqual(['pair', 'unpair']);
    });
  });

  // CD26 and P9: an unpair native never answers is given up, so the engine is never locked for good.
  describe('the unpair bound (CD26, P9)', () => {
    it('gives an unpair up after 5 s with no answer, logs it, and frees the engine', () => {
      const view = renderUnpair({ paired: true });
      const native = holdIntents(view.engine, ['unpair']);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('forget', (outcome) => outcomes.push(outcome)));
      expect(native.held()).toEqual(['unpair']);
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS - 1));
      act(() => view.unpair('orphan'));
      // Still under way: the second call is dropped.
      expect(native.held()).toEqual(['unpair']);
      expect(outcomes).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(outcomes).toEqual(['gave-up']);
      expect(readRecord(view.record).filter((entry) => entry.event === 'unpair.gave-up')).toEqual([
        expect.objectContaining({ level: 'warn', fields: { action: 'forget' } }),
      ]);
      act(() => view.unpair('orphan'));
      // The engine is free for the next caller.
      expect(native.held()).toEqual(['unpair', 'unpair']);
    });

    it('ends an unpair answered in time with no give-up line, once', () => {
      const view = renderUnpair({ paired: true });
      const native = holdIntents(view.engine, ['unpair']);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('forget', (outcome) => outcomes.push(outcome)));
      act(() => native.release());
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS + 1));
      expect(outcomes).toEqual(['idle']);
      expect(events(view)).not.toContain('unpair.gave-up');
    });

    it('reports held when a broadcast became held instead, and sends nothing to end it', () => {
      const view = renderUnpair({ paired: true });
      const native = holdIntents(view.engine, ['unpair']);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('forget', (outcome) => outcomes.push(outcome)));
      act(() => view.engine.hear({ word: 'go-live', cause: 'organiser' }));
      expect(outcomes).toEqual(['held']);
      act(() => native.release());
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS + 1));
      expect(view.engine.getSnapshot().state.kind).not.toBe('idle');
      expect(view.engine.intents.filter((intent) => intent.kind === 'stop')).toEqual([]);
      expect(outcomes).toEqual(['held']);
      expect(events(view)).not.toContain('unpair.gave-up');
    });

    it('resets an Ended engine, and answers idle at once for an Idle one', () => {
      const view = renderUnpair({ paired: true });
      act(() => view.engine.send({ kind: 'start' }));
      // Live first: only a stop once live ends the pairing (owner decision 1); the fake publishes a second on.
      act(() => vi.advanceTimersByTime(1_000));
      expect(view.engine.getSnapshot().state.kind).toBe('publishing');
      act(() => view.engine.send({ kind: 'stop' }));
      expect(view.engine.getSnapshot().state.kind).toBe('ended');
      const first: UnpairOutcome[] = [];
      act(() => view.unpair('orphan', (outcome) => first.push(outcome)));
      expect(view.engine.intents.map((intent) => intent.kind).slice(-1)).toEqual(['reset']);
      expect(first).toEqual(['idle']);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('orphan', (outcome) => outcomes.push(outcome)));
      expect(outcomes).toEqual(['idle']);
      expect(view.engine.intents.map((intent) => intent.kind).slice(-1)).toEqual(['reset']);
    });

    it('answers held at once for a broadcast already on air, and arms no timer', () => {
      const view = renderUnpair({ paired: true });
      act(() => view.engine.scene('live'));
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('orphan', (outcome) => outcomes.push(outcome)));
      expect(outcomes).toEqual(['held']);
      expect(vi.getTimerCount()).toBe(1); // the fake's 1 s report, nothing of ours
    });

    it('ends silently on unmount: no give-up line, and the engine is freed', () => {
      const fakes = createFakePorts();
      pair(fakes);
      const native = holdIntents(fakes.engine, ['unpair']);
      const owner = unpairer(fakes);
      const next = unpairer(fakes);
      act(() => owner.result.current('forget'));
      owner.unmount();
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS + 1));
      expect(events(fakes)).not.toContain('unpair.gave-up');
      act(() => next.result.current('orphan'));
      expect(native.held()).toEqual(['unpair', 'unpair']);
    });
  });

  it('runs again after one that found nothing to clear', () => {
    const fakes = createFakePorts();
    const { result } = unpairer(fakes);
    act(() => result.current('orphan'));
    act(() => pair(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['pair', 'unpair']);
  });
});
