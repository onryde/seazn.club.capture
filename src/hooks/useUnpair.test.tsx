import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  codeStays,
  START_ANSWER_WAIT_MS,
  UNPAIR_GIVE_UP_MS,
  useUnpair,
  type UnpairOutcome,
} from '@/hooks/useUnpair';
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
      const outcomes: UnpairOutcome[] = [];
      act(() => owner.result.current('forget', (outcome) => outcomes.push(outcome)));
      owner.unmount();
      // `left`, not `gave-up`: a Forget whose screen went still forgets (P4 review I1 keeps the code on a give-up only).
      expect(outcomes).toEqual(['left']);
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS + 1));
      expect(outcomes).toEqual(['left']);
      expect(events(fakes)).not.toContain('unpair.gave-up');
      act(() => next.result.current('orphan'));
      expect(native.held()).toEqual(['unpair', 'unpair']);
    });
  });

  // P4 review I1: native ignores an unpair while the operator's start is in flight, so a give-up with the engine still
  // paired may yet arm: Forget and a court Leave keep the code then. Whole-branch review I2: so does a caller that
  // unmounted first (`left`), its screen left with the unpair unanswered. Every row is from the review, none from the code.
  describe('codeStays', () => {
    it.each([
      ['held', 'live', true],
      ['gave-up', 'paired', true],
      ['gave-up', 'live', true],
      ['gave-up', 'stopped', true],
      ['gave-up', 'idle', false],
      ['left', 'paired', true],
      ['left', 'live', true],
      ['left', 'idle', false],
      ['idle', 'idle', false],
    ] as const)('%s with the engine %s: %s', (outcome, status, stays) => {
      const fakes = createFakePorts();
      if (status === 'paired') pair(fakes);
      if (status === 'live') fakes.engine.scene('live');
      if (status === 'stopped') fakes.engine.scene('stopped');
      expect(codeStays(outcome, fakes.engine)).toBe(stays);
    });
  });

  // Court stream Task 13 fix round 1 (the controller's ruling): native ignores an unpair while the operator's start is
  // in flight (`Pairings.unpair`), so a Forget, a court Leave or A7's Confirm sent then was dropped at the 5 s give-up.
  // The clearing now waits for native's answer to the start, then acts on what it finds.
  describe('while the operator’s start is in flight (court stream Task 13)', () => {
    const starting = () => {
      const view = renderUnpair({ paired: true });
      view.engine.setStartAnswer('hold');
      view.engine.send({ kind: 'start' });
      expect(view.engine.getSnapshot().pairing?.starting).toBe(true);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('forget', (outcome) => outcomes.push(outcome)));
      return { view, outcomes };
    };

    it('sends no unpair while native has not answered, then unpairs once a failed start clears it', () => {
      const { view, outcomes } = starting();
      // Native answers a start within its 8 s HTTP bound: past the unpair's own 5 s, nothing given up yet.
      act(() => vi.advanceTimersByTime(8_000));
      expect(kinds(view)).toEqual(['pair', 'start']);
      expect(outcomes).toEqual([]);
      act(() => view.engine.setStartAnswer('failed'));
      expect(kinds(view)).toEqual(['pair', 'start', 'unpair']);
      expect(view.engine.getSnapshot().state.kind).toBe('idle');
      expect(outcomes).toEqual(['idle']);
      expect(events(view)).not.toContain('unpair.gave-up');
    });

    it('answers held when the start it waited for goes live, and sends nothing', () => {
      const { view, outcomes } = starting();
      act(() => view.engine.setStartAnswer('started'));
      expect(outcomes).toEqual(['held']);
      expect(kinds(view)).toEqual(['pair', 'start']);
    });

    it('gives the unpair its own 5 s once the start is answered', () => {
      const { view, outcomes } = starting();
      const native = holdIntents(view.engine, ['unpair']);
      act(() => vi.advanceTimersByTime(START_ANSWER_WAIT_MS - 1));
      act(() => view.engine.setStartAnswer('failed'));
      expect(native.held()).toEqual(['unpair']);
      act(() => vi.advanceTimersByTime(UNPAIR_GIVE_UP_MS - 1));
      expect(outcomes).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(outcomes).toEqual(['gave-up']);
    });

    it('gives up when native never answers the start, sending nothing, and frees the engine', () => {
      const { view, outcomes } = starting();
      act(() => vi.advanceTimersByTime(START_ANSWER_WAIT_MS - 1));
      expect(outcomes).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(outcomes).toEqual(['gave-up']);
      expect(kinds(view)).toEqual(['pair', 'start']);
      expect(readRecord(view.record).filter((entry) => entry.event === 'unpair.gave-up')).toEqual([
        expect.objectContaining({ level: 'warn', fields: { action: 'forget' } }),
      ]);
      // Freed: once the start is answered, the next caller clears it.
      act(() => view.engine.setStartAnswer('failed'));
      act(() => view.unpair('orphan'));
      expect(kinds(view)).toEqual(['pair', 'start', 'unpair']);
    });

    // Fix round 2 m3: native answers a start at the latest at its bridge backstop (`BridgeCore.ANSWER_BACKSTOP_MS`, 16 s),
    // so an answer that late is still waited for.
    it('still waits for a start answered at native’s 16 s backstop, then unpairs', () => {
      const { view, outcomes } = starting();
      act(() => vi.advanceTimersByTime(16_000));
      expect(outcomes).toEqual([]);
      act(() => view.engine.setStartAnswer('failed'));
      expect(kinds(view)).toEqual(['pair', 'start', 'unpair']);
      expect(outcomes).toEqual(['idle']);
      expect(events(view)).not.toContain('unpair.gave-up');
    });

    // Fix round 2 m2: an unpair sent just before the start showed reached native while the start was in flight, and
    // native ignored it, so once the start fails the same paired status is asked again.
    it('sends the unpair again after a failed start that began before native heard the first', () => {
      const view = renderUnpair({ paired: true });
      const native = holdIntents(view.engine, ['unpair']);
      const outcomes: UnpairOutcome[] = [];
      act(() => view.unpair('forget', (outcome) => outcomes.push(outcome)));
      expect(native.held()).toEqual(['unpair']);
      view.engine.setStartAnswer('hold');
      act(() => view.engine.send({ kind: 'start' }));
      expect(view.engine.getSnapshot().pairing?.starting).toBe(true);
      // The first unpair arrives while the start is in flight: native ignores it.
      act(() => native.release());
      expect(view.engine.getSnapshot().state.kind).toBe('paired');
      act(() => view.engine.setStartAnswer('failed'));
      expect(kinds(view)).toEqual(['pair', 'start', 'unpair', 'unpair']);
      expect(view.engine.getSnapshot().state.kind).toBe('idle');
      expect(outcomes).toEqual(['idle']);
    });

    it('ends silently when its caller unmounts while it waits', () => {
      const fakes = createFakePorts();
      pair(fakes);
      fakes.engine.setStartAnswer('hold');
      fakes.engine.send({ kind: 'start' });
      const { result, unmount } = unpairer(fakes);
      const outcomes: UnpairOutcome[] = [];
      act(() => result.current('forget', (outcome) => outcomes.push(outcome)));
      unmount();
      act(() => fakes.engine.setStartAnswer('failed'));
      act(() => vi.advanceTimersByTime(START_ANSWER_WAIT_MS + UNPAIR_GIVE_UP_MS));
      expect(outcomes).toEqual(['left']);
      expect(kinds(fakes)).toEqual(['pair', 'start']);
      expect(events(fakes)).not.toContain('unpair.gave-up');
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
