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
    expect(view.result.current.sheet).toMatchObject({ kind: 'setScore', game: 1 });
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

/**
 * Owner ruling 14 (2026-10-31): "the tapped half flashes lime briefly so you see at a glance your tap counted". The
 * hook numbers each tap on a half that counted; the screen hands each half its cue (`flashCue`). Not on a refusal, a
 * bounced repeat, Undo, Set score, a sanction, the preview row, or a first mount.
 */
describe('useBadmintonPadPreview, the flash of a half whose tap counted', () => {
  it('has no flash before any tap: nothing counted yet', () => {
    expect(mount().result.current.flash).toBeNull();
  });

  it('flashes the tapped half, and a second counted tap on the same half is a new flash', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 1 });
    at(fakes, 1000);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 2 });
    at(fakes, 2000);
    act(() => view.result.current.actions.tapHalf('second'));
    expect(view.result.current.flash).toEqual({ side: 'second', seq: 3 });
  });

  it('does not flash for a bounced repeat, which counted once', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    at(fakes, 100);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 1 });
  });

  it('does not flash for a refused tap: a rally once the match is decided', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    for (let rally = 1; rally <= 42; rally += 1) {
      at(fakes, rally * 1000);
      act(() => view.result.current.actions.tapHalf('first'));
    }
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 42 });
    at(fakes, 60_000);
    act(() => view.result.current.actions.tapHalf('second'));
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.notNow'));
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 42 });
  });

  it('does not flash for Undo, Set score or a sanction', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tool('setScore'));
    act(() => view.result.current.actions.saveScore('5', '3'));
    act(() => view.result.current.actions.tool('sanction.second'));
    act(() => view.result.current.actions.choose('warning'));
    act(() => view.result.current.actions.choose('0'));
    at(fakes, 1000);
    act(() => view.result.current.actions.undo());
    expect(points(view)).toEqual(['5', '3']);
    expect(view.result.current.flash).toBeNull();
  });

  it.each(['resultRecorded', 'pad', 'doubles', 'sync'] as const)(
    'clears the flash when the preview row picks %s, mid-flash: the new state never flashes',
    (choice) => {
      const view = mount();
      act(() => view.result.current.actions.tapHalf('second'));
      act(() => view.result.current.actions.pick(choice));
      expect(view.result.current.flash).toBeNull();
    },
  );

  it('numbers on after a clear, so the next counted tap on the same half is a new flash', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    act(() => view.result.current.actions.pick('pad'));
    at(fakes, 1000);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 2 });
  });

  it('starts with no flash on a return to the pad, the match kept', () => {
    const fakes = createFakePorts();
    const first = mount(fakes);
    act(() => first.result.current.actions.tapHalf('first'));
    first.unmount();
    const again = mount(fakes);
    expect(points(again)).toEqual(['1', '0']);
    expect(again.result.current.flash).toBeNull();
  });
});

/** Owner ruling 15 (2026-10-31): a Rules button opens a sheet over the pad with the match's rules and Close. */
describe('useBadmintonPadPreview, the Match details sheet', () => {
  /** The preview's rules (best of 3, 21 won by 2, capped at 30, the interval at 11), as the brief states them. */
  const LINES = [
    { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
    { key: 'scoring.badminton.rules.points', vars: { points: 21, winBy: 2 } },
    { key: 'scoring.badminton.rules.cap', vars: { cap: 30 } },
    { key: 'scoring.badminton.intervalAt', vars: { point: 11 } },
    { key: 'scoring.badminton.rules.endsChange', vars: { point: 11, game: 3 } },
  ];

  it('opens Match details over the pad: where the match sits and its rules, and changes nothing on it', () => {
    const view = mount();
    act(() => view.result.current.actions.tapHalf('first'));
    const before = view.result.current.view;
    act(() => view.result.current.actions.details());
    expect(view.result.current.sheet).toEqual({
      kind: 'details',
      details: {
        context: {
          competition: 'Spring Open 2026',
          division: 'U15 Boys Singles',
          round: 'Round 1',
          match: 'Match 4',
          sides: ['A. Sharma', 'L. Chen'],
        },
        rules: LINES,
      },
    });
    expect(view.result.current.view).toBe(before);
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 1 });
  });

  it('opens once for a second tap: one Back closes it, and the next leaves for Home', () => {
    const fakes = createFakePorts();
    act(() => fakes.navigation.go('scoringPreview'));
    const view = mount(fakes);
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.details());
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(view.result.current.sheet).toBeNull();
    expect(fakes.navigation.current()).toBe('scoringPreview');
    act(() => {
      fakes.back.press();
    });
    expect(fakes.navigation.current()).toBe('home');
  });

  it('closes on Close, and when the preview row picks a state', () => {
    const view = mount();
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.cancel());
    expect(view.result.current.sheet).toBeNull();
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.pick('viewOnly'));
    expect(view.result.current.sheet).toBeNull();
  });
});
