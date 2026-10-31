import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBadmintonPadPreview } from '@/hooks/useBadmintonPadPreview';
import { createFakePorts, TEST_NOW, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

function mount(fakes: FakePorts = createFakePorts()) {
  return renderHook(() => useBadmintonPadPreview(), { wrapper: wrapperFor(fakes) });
}

const refusal = (key: string) => ({ kind: 'refusal', key });
const COUNTED_ONCE = { kind: 'note', key: 'scoring.pad.countedOnce' };
const at = (fakes: FakePorts, ms: number) => fakes.setNow(new Date(TEST_NOW.getTime() + ms));

const points = (view: ReturnType<typeof mount>) =>
  view.result.current.view.halves.map((half) => half.value);

/** The four questions' empty input (AGENTS §10): what the screen cannot send, the hook still answers safely. */
describe('useBadmintonPadPreview, given what the screen never sends', () => {
  it.each([
    ['', '5'],
    ['5', 'abc'],
    ['3.5', '1'],
    ['-1', '2'],
  ])(
    'refuses Set score fields %j and %j as a score no game has, and changes nothing',
    (first, second) => {
      const view = mount();
      act(() => view.result.current.actions.tool('setScore'));
      act(() => view.result.current.actions.saveScore(first, second));
      expect(view.result.current.line).toEqual(refusal('scoring.refusal.invalidScore'));
      expect(view.result.current.sheet).toBeNull();
      expect(points(view)).toEqual(['0', '0']);
    },
  );

  it.each(['', 'sanction', 'sanction.third', 'undo'])('opens nothing for a tool id %j', (id) => {
    const view = mount();
    act(() => view.result.current.actions.tool(id));
    expect(view.result.current.sheet).toBeNull();
  });

  it('ignores a choice with no sheet up, and one the step does not offer', () => {
    const view = mount();
    act(() => view.result.current.actions.choose('warning'));
    expect(view.result.current.sheet).toBeNull();
    act(() => view.result.current.actions.tool('sanction.first'));
    act(() => view.result.current.actions.choose('yellow-card'));
    expect(view.result.current.sheet?.kind).toBe('sanction');
    act(() => view.result.current.actions.choose('9'));
    expect(view.result.current.view.lastTap).toBeNull();
  });

  it('ignores a sanction choice while Set score is up', () => {
    const view = mount();
    act(() => view.result.current.actions.tool('setScore'));
    act(() => view.result.current.actions.choose('warning'));
    expect(view.result.current.sheet?.kind).toBe('setScore');
    expect(view.result.current.view.lastTap).toBeNull();
  });

  it('says Undo has nothing to take back when nothing is this phone’s', () => {
    const view = mount();
    act(() => view.result.current.actions.undo());
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.nothingToUndo'));
  });

  it('refuses the ending’s answers when no disqualification waits', () => {
    const view = mount();
    act(() => view.result.current.actions.recordEnding());
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.notNow'));
    act(() => view.result.current.actions.voidSanction());
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.notNow'));
  });
});

/**
 * The bounce window (`bounce.ts`, the web pad's 250 ms): a repeat of the same tap counts once and says so; a refused
 * tap arms nothing; a clock that steps back (the phone's time corrected) never swallows a tap.
 */
describe('useBadmintonPadPreview, a tap that comes twice', () => {
  it('counts a refused Undo again, never once: nothing counted to repeat', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.undo());
    at(fakes, 100);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.nothingToUndo'));
  });

  it('counts a rally after the clock steps back as a new rally', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, 60_000);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 0);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(points(view)).toEqual(['2', '0']);
    expect(view.result.current.line).toBeNull();
  });

  it('counts an Undo after the clock steps back as a new Undo', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 1000);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 60_000);
    act(() => view.result.current.actions.undo());
    at(fakes, 59_900);
    act(() => view.result.current.actions.undo());
    expect(points(view)).toEqual(['0', '0']);
  });

  it('counts a repeated Undo once, and says so', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 1000);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 2000);
    act(() => view.result.current.actions.undo());
    at(fakes, 2100);
    act(() => view.result.current.actions.undo());
    expect(points(view)).toEqual(['1', '0']);
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
  });
});

/** Back leaves the preview freely (owner ruling 10); a return finds the match where it was (AGENTS §10 q3). */
describe('useBadmintonPadPreview, left and returned to', () => {
  it('finds the same match on a second mount over the same ports', () => {
    const fakes = createFakePorts();
    const first = mount(fakes);
    act(() => first.result.current.actions.tapHalf('second'));
    first.unmount();
    expect(points(mount(fakes))).toEqual(['0', '1']);
  });

  it('starts afresh on another launch (other ports)', () => {
    const first = mount();
    act(() => first.result.current.actions.tapHalf('second'));
    expect(points(mount())).toEqual(['0', '0']);
  });

  it('keeps a picked sample on a return', () => {
    const fakes = createFakePorts();
    const first = mount(fakes);
    act(() => first.result.current.actions.pick('doubles'));
    first.unmount();
    expect(mount(fakes).result.current.chosen.sample).toBe('doubles');
  });
});
