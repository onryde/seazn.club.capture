import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TAKEN, refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import { useHeldServing } from '@/hooks/useHeldServing';

// The answer to Who is serving? while it waits for the next point (plan S2-2 Task 7, the controller's rulings on the held
// answer): it rides exactly one point, only while the pad needs it, and is gone when the engine names a server.

function mount(anchorNeeded: boolean, scoreEvents = 0) {
  return renderHook(
    ({ needed, events }: { needed: boolean; events: number }) => useHeldServing(needed, events),
    { initialProps: { needed: anchorNeeded, events: scoreEvents } },
  );
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
    rerender({ needed: false, events: 0 });
    expect(result.current.side).toBeNull();
    rerender({ needed: true, events: 0 });
    expect(result.current.side).toBeNull();
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual([null]);
  });

  it('is felt by a point tapped in the commit that shows it: the answer is gone before the tap can read it', () => {
    const { result, rerender } = mount(true);
    act(() => void result.current.put('first'));
    const send = vi.fn(() => TAKEN);
    rerender({ needed: false, events: 0 });
    act(() => void result.current.carry(send));
    expect(send).toHaveBeenCalledWith(null);
  });

  it('does not clear a fresh answer when nothing changed: a redraw alone keeps it', () => {
    const { result, rerender } = mount(true);
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 0 });
    expect(result.current.side).toBe('first');
  });
});

// Task 7 fix round 1 (I1): the answer is about the score it was made at. A rally that names no `serving` from another scorer
// leaves the pad needing an answer, but the score has moved: carried to the next rally it would be taken as an anchor at
// the wrong score.
describe('the score moving', () => {
  it('drops the answer when the count of score events changes, and it is not back when the count returns', () => {
    const { result, rerender } = mount(true, 3);
    act(() => void result.current.put('second'));
    rerender({ needed: true, events: 4 });
    expect(result.current.side).toBeNull();
    rerender({ needed: true, events: 3 });
    expect(result.current.side).toBeNull();
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual([null]);
  });

  it('is felt by a point tapped in the commit that shows the new count', () => {
    const { result, rerender } = mount(true, 3);
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 4 });
    const send = vi.fn(() => TAKEN);
    act(() => void result.current.carry(send));
    expect(send).toHaveBeenCalledWith(null);
  });

  it('records the count at the moment of the answer, not at mount', () => {
    const { result, rerender } = mount(true, 1);
    rerender({ needed: true, events: 2 });
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 2 });
    expect(result.current.side).toBe('first');
    rerender({ needed: true, events: 3 });
    expect(result.current.side).toBeNull();
  });

  it('an answer made after the count moved is dropped when it falls back to where the pad opened (a void)', () => {
    const { result, rerender } = mount(true, 1);
    rerender({ needed: true, events: 2 });
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 1 });
    expect(result.current.side).toBeNull();
  });

  it('a new answer after the move is held at the new count', () => {
    const { result, rerender } = mount(true, 3);
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 4 });
    act(() => void result.current.put('second'));
    expect(result.current.side).toBe('second');
    const sent = point();
    act(() => void result.current.carry(sent.send));
    expect(sent.seen).toEqual(['second']);
  });

  it('a redraw with the same count keeps the answer', () => {
    const { result, rerender } = mount(true, 3);
    act(() => void result.current.put('first'));
    rerender({ needed: true, events: 3 });
    expect(result.current.side).toBe('first');
  });
});
