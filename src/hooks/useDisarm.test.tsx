import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDisarm } from '@/hooks/useDisarm';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { streamSession } from '../../test/fixtures/session';
import { holdIntents } from '../../test/holdIntents';
import { wrapperFor } from '../../test/renderWithPorts';

const session = streamSession();
const arm = (fakes: FakePorts) =>
  fakes.engine.send({
    kind: 'arm',
    session,
    heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
  });
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);

function disarmer(fakes: FakePorts) {
  return renderHook(() => useDisarm(), { wrapper: wrapperFor(fakes) });
}

/** I1 (final review): a session no saved code owns is cleared by native's own path. */
describe('useDisarm', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops an armed session, then resets it once native reports it Ended', () => {
    const fakes = createFakePorts();
    arm(fakes);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    expect(readRecord(fakes.record).map(({ event, fields }) => ({ event, fields }))).toEqual([
      { event: 'intent.stop', fields: { action: 'forget' } },
      { event: 'intent.reset', fields: { action: 'forget' } },
    ]);
  });

  it.each(['stopped', 'stopped-by-organiser', 'fatal'] as const)(
    'resets a %s session, and never stops it',
    (scene) => {
      const fakes = createFakePorts();
      fakes.engine.scene(scene);
      const { result } = disarmer(fakes);
      act(() => result.current('orphan'));
      expect(kinds(fakes)).toEqual(['reset']);
      expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    },
  );

  it('never touches a broadcast, nor what follows it', () => {
    const fakes = createFakePorts();
    fakes.engine.scene('live');
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    act(() => fakes.engine.scene('stopped'));
    expect(kinds(fakes)).toEqual([]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
  });

  it('sends nothing at idle, and nothing to the next session armed', () => {
    const fakes = createFakePorts();
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    act(() => arm(fakes));
    expect(kinds(fakes)).toEqual(['arm']);
  });

  it('asks once per status: reports while the stop is unanswered send nothing more', () => {
    const fakes = createFakePorts();
    arm(fakes);
    const native = holdIntents(fakes.engine, ['stop']);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    // The fake reports once a second, changed or not, as native does.
    act(() => vi.advanceTimersByTime(2500));
    expect(native.held()).toEqual(['stop']);
    act(() => native.release());
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
  });

  it('stops listening on unmount', () => {
    const fakes = createFakePorts();
    arm(fakes);
    const native = holdIntents(fakes.engine, ['stop']);
    const { result, unmount } = disarmer(fakes);
    act(() => result.current('forget'));
    unmount();
    act(() => native.release());
    expect(kinds(fakes)).toEqual(['arm', 'stop']);
    expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
  });

  // A second call, both ways: dropped while one is under way, run once it has ended.
  it('drops a call while one is under way, and runs the next one after', () => {
    const fakes = createFakePorts();
    arm(fakes);
    const native = holdIntents(fakes.engine, ['stop']);
    const { result } = disarmer(fakes);
    act(() => result.current('forget'));
    act(() => result.current('forget'));
    expect(native.held()).toEqual(['stop']);
    act(() => native.release());
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
    act(() => arm(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset', 'arm', 'stop', 'reset']);
  });

  // Final fix round 2, M-d: Forget and the reopen gate are two callers of one
  // clearing. A foreground while Forget's stop is unanswered sends no second stop.
  describe('one clearing per engine, whoever asks', () => {
    it('drops another caller while one is under way', () => {
      const fakes = createFakePorts();
      arm(fakes);
      const native = holdIntents(fakes.engine, ['stop']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      act(() => gate.result.current('orphan'));
      expect(native.held()).toEqual(['stop']);
      act(() => native.release());
      expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
      expect(readRecord(fakes.record).map(({ event, fields }) => ({ event, fields }))).toEqual([
        { event: 'intent.stop', fields: { action: 'forget' } },
        { event: 'intent.reset', fields: { action: 'forget' } },
      ]);
    });

    it('lets another caller run once it has ended', () => {
      const fakes = createFakePorts();
      arm(fakes);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      act(() => arm(fakes));
      act(() => gate.result.current('orphan'));
      expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset', 'arm', 'stop', 'reset']);
    });

    it('is not ended by another caller unmounting', () => {
      const fakes = createFakePorts();
      arm(fakes);
      const native = holdIntents(fakes.engine, ['stop']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      gate.unmount();
      act(() => native.release());
      expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
    });

    it('frees the engine when its owner unmounts, so the next caller can clear it', () => {
      const fakes = createFakePorts();
      arm(fakes);
      const native = holdIntents(fakes.engine, ['stop']);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      act(() => forget.result.current('forget'));
      forget.unmount();
      act(() => native.release());
      expect(fakes.engine.getSnapshot().state.kind).toBe('ended');
      act(() => gate.result.current('orphan'));
      expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
      expect(fakes.engine.getSnapshot().state.kind).toBe('idle');
    });

    it('never frees a later clearing when a caller that already finished unmounts', () => {
      const fakes = createFakePorts();
      arm(fakes);
      const forget = disarmer(fakes);
      const gate = disarmer(fakes);
      const third = disarmer(fakes);
      // Forget's clearing ends after it returned: native answers its stop later.
      const first = holdIntents(fakes.engine, ['stop']);
      act(() => forget.result.current('forget'));
      act(() => first.release());
      act(() => arm(fakes));
      const native = holdIntents(fakes.engine, ['stop']);
      act(() => gate.result.current('orphan'));
      forget.unmount();
      act(() => third.result.current('orphan'));
      expect(native.held()).toEqual(['stop']);
    });

    it('keeps engines apart: a clearing on one never blocks another', () => {
      const one = createFakePorts();
      const two = createFakePorts();
      arm(one);
      arm(two);
      holdIntents(one.engine, ['stop']);
      const first = disarmer(one);
      const second = disarmer(two);
      act(() => first.result.current('forget'));
      act(() => second.result.current('forget'));
      expect(kinds(two)).toEqual(['arm', 'stop', 'reset']);
    });
  });

  it('runs again after one that found nothing to clear', () => {
    const fakes = createFakePorts();
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    act(() => arm(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
  });
});
