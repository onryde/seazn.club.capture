import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useContinueScoring, useScoringRows } from '@/hooks/useScoringHome';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';
import { leave, queueHolding } from '../../test/scoringHomeFixtures';

// The hooks under Home's Remote Scoring cards (plan S2-1 Task 10), on their own: what the screen tests cannot see.

describe('useScoringRows', () => {
  it('hands out the same rows while the disk reads the same, so Home does not render for nothing', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7' }));
    const hook = renderHook(() => useScoringRows(), { wrapper: wrapperFor(fakes) });
    await act(async () => undefined);
    const first = hook.result.current.rows;
    expect(first).toHaveLength(1);
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.rows).toBe(first);
  });

  it('hands out new rows when a count moves', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7' }));
    const hook = renderHook(() => useScoringRows(), { wrapper: wrapperFor(fakes) });
    await act(async () => undefined);
    const first = hook.result.current.rows;
    await leave(fakes, queueHolding('fx-old', 1, { label: 'Match 7' }));
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.rows).not.toBe(first);
    const [row] = hook.result.current.rows;
    expect(row?.kind === 'queue' ? row.queue.pending.length : -1).toBe(1);
  });
});

describe('useContinueScoring', () => {
  it('does nothing when no match is saved: no mode made active, no route, no panel', async () => {
    const fakes = createFakePorts();
    await act(() => fakes.ports.modeStore.load());
    const setStatusKey = vi.fn();
    const saveFailed = vi.fn();
    const setPanel = vi.fn();
    const hook = renderHook(() => useContinueScoring(setStatusKey, saveFailed, setPanel), {
      wrapper: wrapperFor(fakes),
    });
    act(() => hook.result.current());
    await act(async () => undefined);
    expect(fakes.navigation.history).toEqual([]);
    expect(fakes.kv.entries.size).toBe(0);
    expect([setStatusKey, saveFailed, setPanel].map((spy) => spy.mock.calls.length)).toEqual([
      0, 0, 0,
    ]);
  });
});
