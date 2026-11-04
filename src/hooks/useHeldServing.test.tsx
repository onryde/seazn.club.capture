import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TAKEN, refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import { useHeldServing } from '@/hooks/useHeldServing';

// The answer to Who is serving? while it waits for the next point (plan S2-2 Task 7, the controller's rulings on the held
// answer): it rides exactly one point, only while the pad needs it, and is gone when the engine names a server.

function mount(anchorNeeded: boolean) {
  return renderHook(({ needed }: { needed: boolean }) => useHeldServing(needed), {
    initialProps: { needed: anchorNeeded },
  });
}

/** A point that sees what it was handed, and is taken (or refused). */
const point = (outcome: PadOutcome = TAKEN) => {
  const seen: (PadSide | null)[] = [];
  return { seen, send: (serving: PadSide | null) => (seen.push(serving), outcome) };
};

describe('put', () => {
  it('holds the side it is given, and a second answer replaces the first', () => {
    const { result } = mount(true);
    expect(result.current.side).toBeNull();
    act(() => void result.current.put('first'));
    expect(result.current.side).toBe('first');
    act(() => void result.current.put('second'));
    expect(result.current.side).toBe('second');
  });

  it('takes nothing while the pad needs no answer, and says so', () => {
    const { result } = mount(false);
    let taken = true;
    act(() => {
      taken = result.current.put('first');
    });
    expect(taken).toBe(false);
    expect(result.current.side).toBeNull();
  });

  it('says it took the answer when the pad needs one', () => {
    const { result } = mount(true);
    let taken = false;
    act(() => {
      taken = result.current.put('second');
    });
    expect(taken).toBe(true);
  });
});

describe('carry', () => {
  it('hands the held side to the point, and clears it when the point is taken', () => {
    const { result } = mount(true);
    act(() => void result.current.put('second'));
    const first = point();
    act(() => void result.current.carry(first.send));
    expect(first.seen).toEqual(['second']);
    expect(result.current.side).toBeNull();
    const next = point();
    act(() => void result.current.carry(next.send));
    expect(next.seen).toEqual([null]);
  });

  it('hands nothing when nothing is held', () => {
    const { result } = mount(true);
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual([null]);
  });

  it('answers what the point came to', () => {
    const { result } = mount(true);
    let outcome: PadOutcome | null = null;
    act(() => {
      outcome = result.current.carry(point(refusing('notNow')).send);
    });
    expect(outcome).toEqual(refusing('notNow'));
  });

  it('keeps the answer for the next point when this one is refused', () => {
    const { result } = mount(true);
    act(() => void result.current.put('first'));
    act(() => void result.current.carry(point(refusing('notNow')).send));
    expect(result.current.side).toBe('first');
    const next = point();
    act(() => void result.current.carry(next.send));
    expect(next.seen).toEqual(['first']);
  });

  it('two points before the pad redraws: only the first is handed it', () => {
    const { result } = mount(true);
    act(() => void result.current.put('first'));
    const [one, two] = [point(), point()];
    const carry = result.current.carry;
    act(() => {
      carry(one.send);
      carry(two.send);
    });
    expect([one.seen, two.seen]).toEqual([['first'], [null]]);
  });

  it('hands a point the side put in the same breath, before any redraw', () => {
    const { result } = mount(true);
    const sent = point();
    act(() => {
      result.current.put('second');
      result.current.carry(sent.send);
    });
    expect(sent.seen).toEqual(['second']);
  });
});

describe('clear', () => {
  it('drops the answer, as Undo and Set score do', () => {
    const { result } = mount(true);
    act(() => void result.current.put('first'));
    act(() => result.current.clear());
    expect(result.current.side).toBeNull();
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual([null]);
  });
});

describe('the engine naming a server', () => {
  it('drops the answer, and it is not back when the anchor is lost again', () => {
    const { result, rerender } = mount(true);
    act(() => void result.current.put('second'));
    rerender({ needed: false });
    expect(result.current.side).toBeNull();
    rerender({ needed: true });
    expect(result.current.side).toBeNull();
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual([null]);
  });

  it('is felt by a point tapped in the commit that shows it: the answer is gone before the tap can read it', () => {
    const { result, rerender } = mount(true);
    act(() => void result.current.put('first'));
    const send = vi.fn(() => TAKEN);
    rerender({ needed: false });
    act(() => void result.current.carry(send));
    expect(send).toHaveBeenCalledWith(null);
  });

  it('does not clear a fresh answer when nothing changed: a redraw alone keeps it', () => {
    const { result, rerender } = mount(true);
    act(() => void result.current.put('first'));
    rerender({ needed: true });
    expect(result.current.side).toBe('first');
  });
});
