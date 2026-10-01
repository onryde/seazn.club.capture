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

  it('runs again after one that found nothing to clear', () => {
    const fakes = createFakePorts();
    const { result } = disarmer(fakes);
    act(() => result.current('orphan'));
    act(() => arm(fakes));
    act(() => result.current('orphan'));
    expect(kinds(fakes)).toEqual(['arm', 'stop', 'reset']);
  });
});
