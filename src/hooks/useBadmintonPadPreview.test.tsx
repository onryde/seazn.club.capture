import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBadmintonPadPreview } from '@/hooks/useBadmintonPadPreview';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

function mount() {
  const fakes = createFakePorts();
  return renderHook(() => useBadmintonPadPreview(), { wrapper: wrapperFor(fakes) });
}

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
      expect(view.result.current.refusal).toBe('scoring.refusal.invalidScore');
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
    expect(view.result.current.refusal).toBe('scoring.refusal.nothingToUndo');
  });

  it('refuses the ending’s answers when no disqualification waits', () => {
    const view = mount();
    act(() => view.result.current.actions.recordEnding());
    expect(view.result.current.refusal).toBe('scoring.refusal.notNow');
    act(() => view.result.current.actions.voidSanction());
    expect(view.result.current.refusal).toBe('scoring.refusal.notNow');
  });
});
