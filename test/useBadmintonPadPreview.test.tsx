import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakePorts, TEST_NOW, type FakePorts } from './fakePorts';
import { wrapperFor } from './renderWithPorts';
import { useBadmintonPadPreview } from './useBadmintonPadPreview';

/**
 * The preview's hook, its match started as the Start screen starts it, the first side serving (owner, 2026-11-01:
 * the samples begin not started), unless `notStarted`.
 */
function mount(fakes: FakePorts = createFakePorts(), { notStarted = false } = {}) {
  const view = renderHook(() => useBadmintonPadPreview(), { wrapper: wrapperFor(fakes) });
  if (!notStarted && view.result.current.view.start !== null) {
    // Started a minute before the test's own taps, so none of them falls in the start's bounce window.
    const before = fakes.ports.clock();
    fakes.setNow(new Date(before.getTime() - 60_000));
    act(() => view.result.current.actions.pickServer('first'));
    act(() => view.result.current.actions.start());
    fakes.setNow(before);
  }
  return view;
}

const refusal = (key: string) => ({ kind: 'refusal', key });
const COUNTED_ONCE = { kind: 'note', key: 'scoring.pad.countedOnce' };
const at = (fakes: FakePorts, ms: number) => fakes.setNow(new Date(TEST_NOW.getTime() + ms));
let seconds = 0;
/** The phone's clock a second on: a sheet's step taps well after it appeared, never in its bounce window. */
const aSecondOn = (fakes: FakePorts) => {
  seconds += 1;
  at(fakes, seconds * 1000);
};

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
      const fakes = createFakePorts();
      const view = mount(fakes);
      act(() => view.result.current.actions.tool('setScore'));
      aSecondOn(fakes);
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
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.choose('warning'));
    expect(view.result.current.sheet).toBeNull();
    act(() => view.result.current.actions.tool('sanction.first'));
    aSecondOn(fakes);
    act(() => view.result.current.actions.choose('yellow-card'));
    expect(view.result.current.sheet?.kind).toBe('sanction');
    aSecondOn(fakes);
    act(() => view.result.current.actions.choose('9'));
    // Nothing recorded: the line still says the start.
    expect(view.result.current.view.lastTap?.text.key).toBe('scoring.badminton.last.start');
  });

  it('ignores a sanction choice while Set score is up', () => {
    const view = mount();
    act(() => view.result.current.actions.tool('setScore'));
    act(() => view.result.current.actions.choose('warning'));
    expect(view.result.current.sheet).toMatchObject({ kind: 'setScore', game: 1 });
    expect(view.result.current.view.lastTap?.text.key).toBe('scoring.badminton.last.start');
  });

  it('says Undo has nothing to take back when nothing is this phone’s', () => {
    const view = mount(createFakePorts(), { notStarted: true });
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
    const view = mount(fakes, { notStarted: true });
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
    aSecondOn(fakes);
    act(() => view.result.current.actions.saveScore('5', '3'));
    aSecondOn(fakes);
    act(() => view.result.current.actions.tool('sanction.second'));
    aSecondOn(fakes);
    act(() => view.result.current.actions.choose('warning'));
    aSecondOn(fakes);
    act(() => view.result.current.actions.choose('0'));
    aSecondOn(fakes);
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
  const ROWS = [
    {
      label: { key: 'scoring.badminton.rules.format.label' },
      value: { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
    },
    {
      label: { key: 'scoring.badminton.rules.points.label' },
      value: { key: 'scoring.badminton.rules.points.value', vars: { points: 21, winBy: 2 } },
    },
    {
      label: { key: 'scoring.badminton.rules.cap.label' },
      value: { key: 'scoring.badminton.rules.cap.value', vars: { cap: 30 } },
    },
    {
      label: { key: 'scoring.badminton.rules.interval.label' },
      value: { key: 'scoring.badminton.rules.interval.value', vars: { point: 11 } },
    },
    {
      label: { key: 'scoring.badminton.rules.endsChange.label' },
      value: { key: 'scoring.badminton.rules.endsChange.value', vars: { point: 11, game: 3 } },
    },
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
        rules: ROWS,
      },
    });
    expect(view.result.current.view).toBe(before);
    expect(view.result.current.flash).toEqual({ side: 'first', seq: 1 });
  });

  it('opens once for a second tap: one Back closes it, and the next leaves for Home', () => {
    const fakes = createFakePorts();
    act(() => fakes.navigation.go('scoring'));
    const view = mount(fakes);
    act(() => view.result.current.actions.details());
    act(() => view.result.current.actions.details());
    let handled = false;
    act(() => {
      handled = fakes.back.press();
    });
    expect(handled).toBe(true);
    expect(view.result.current.sheet).toBeNull();
    expect(fakes.navigation.current()).toBe('scoring');
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

// Owner, 2026-11-01, option A: the samples begin not started; the Start screen asks who serves first, and Start match,
// a tap, starts the match with that side serving. Undo right after it returns to the Start screen, the pick cleared.
describe('useBadmintonPadPreview, the Start screen', () => {
  const unstarted = () => mount(createFakePorts(), { notStarted: true });
  const plates = (view: ReturnType<typeof mount>) =>
    view.result.current.view.halves.map((half) => half.serving?.shown.key ?? null);

  it('opens on the Start screen, nothing picked', () => {
    const view = unstarted();
    expect(view.result.current.view.start?.sides.map((side) => side.label)).toEqual([
      'A. Sharma',
      'L. Chen',
    ]);
    expect(view.result.current.toss).toBeNull();
  });

  it('starts nothing until a side is picked (empty input)', () => {
    const view = unstarted();
    act(() => view.result.current.actions.start());
    expect(view.result.current.view.start).not.toBeNull();
    expect(view.result.current.line).toBeNull();
  });

  it('starts the match with the side picked serving from the right at 0-0, and clears the pick', () => {
    const view = unstarted();
    act(() => view.result.current.actions.pickServer('second'));
    expect(view.result.current.toss).toBe('second');
    act(() => view.result.current.actions.start());
    expect(view.result.current.view.start).toBeNull();
    expect(view.result.current.toss).toBeNull();
    expect(points(view)).toEqual(['0', '0']);
    expect(plates(view)).toEqual([null, 'scoring.badminton.serving.right']);
    expect(view.result.current.view.lastTap).toEqual({
      text: { key: 'scoring.badminton.last.start', vars: { side: 'L. Chen' } },
      undo: true,
    });
  });

  it('does nothing for a second Start, however close behind (a second call)', () => {
    const view = unstarted();
    act(() => view.result.current.actions.pickServer('second'));
    const { start } = view.result.current.actions;
    act(() => {
      start();
      start();
    });
    act(() => view.result.current.actions.pickServer('first'));
    act(() => view.result.current.actions.start());
    expect(view.result.current.line).toBeNull();
    expect(plates(view)).toEqual([null, 'scoring.badminton.serving.right']);
  });

  // Hardening (2026-11-01): the second tap of a fast double tap on Start lands on the pad. Within the bounce window
  // of the start it is the same tap, whatever it lands on: a half or Undo counts once, and says so.
  it.each([
    ['a half', (view: ReturnType<typeof mount>) => view.result.current.actions.tapHalf('first')],
    ['Undo', (view: ReturnType<typeof mount>) => view.result.current.actions.undo()],
  ] as const)('counts %s within the bounce window of the start as the same tap', (_what, tap) => {
    const fakes = createFakePorts();
    const view = mount(fakes, { notStarted: true });
    act(() => view.result.current.actions.pickServer('second'));
    act(() => view.result.current.actions.start());
    at(fakes, 249);
    act(() => tap(view));
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(view.result.current.view.start).toBeNull();
    expect(points(view)).toEqual(['0', '0']);
    expect(view.result.current.flash).toBeNull();
    at(fakes, 250);
    act(() => view.result.current.actions.tapHalf('first'));
    expect(points(view)).toEqual(['1', '0']);
  });

  it('returns to the Start screen on an Undo right after it, the pick cleared', () => {
    const fakes = createFakePorts();
    const view = mount(fakes, { notStarted: true });
    act(() => view.result.current.actions.pickServer('second'));
    act(() => view.result.current.actions.start());
    at(fakes, 1000);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.view.start).not.toBeNull();
    expect(view.result.current.toss).toBeNull();
    expect(view.result.current.view.lastTap).toBeNull();
  });

  it('clears the pick on a pick from the preview row, and Start begins the sample afresh, not started', () => {
    const view = unstarted();
    act(() => view.result.current.actions.pickServer('second'));
    act(() => view.result.current.actions.pick('doubles'));
    expect(view.result.current.toss).toBeNull();
    // The doubles sample was started by its other scorer, and is under way.
    expect(view.result.current.view.start).toBeNull();
    act(() => view.result.current.actions.pick('start'));
    expect(view.result.current.view.start?.sides.map((side) => side.label)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
    expect(view.result.current.chosen.sample).toBe('doubles');
    expect(points(view)).toEqual(['0', '0']);
  });
});

// Hardening (2026-11-01): the four questions (AGENTS §10) across rounds 2–7, where the hook answers them.
describe('useBadmintonPadPreview, the four questions (hardening, 2026-11-01)', () => {
  const PROMPT = { kind: 'ending', person: 'L. Chen' };
  /** L. Chen disqualified, as the sanction sheet's steps record it, a second apart: the ending prompt then waits. */
  const disqualify = (view: ReturnType<typeof mount>, fakes: FakePorts) => {
    act(() => view.result.current.actions.tool('sanction.second'));
    for (const choice of ['disqualification', '0', 'confirm']) {
      aSecondOn(fakes);
      act(() => view.result.current.actions.choose(choice));
    }
    aSecondOn(fakes);
  };

  // A second call: the second tap of a fast double tap on Start match can land on a tool in the controls that take the
  // Start screen's room. Within the window it opens nothing, as a half or Undo there counts nothing.
  it('opens no tool within the bounce window of the start, and says so; after it, the tool opens', () => {
    const fakes = createFakePorts();
    const view = mount(fakes, { notStarted: true });
    act(() => view.result.current.actions.pickServer('first'));
    act(() => view.result.current.actions.start());
    at(fakes, 249);
    act(() => view.result.current.actions.tool('sanction.second'));
    expect(view.result.current.sheet).toBeNull();
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    at(fakes, 250);
    act(() => view.result.current.actions.tool('setScore'));
    expect(view.result.current.sheet?.kind).toBe('setScore');
  });

  it('opens a tool at once after a rally: only the start opens the window for every tap', () => {
    const view = mount();
    act(() => view.result.current.actions.tapHalf('first'));
    act(() => view.result.current.actions.tool('sanction.second'));
    expect(view.result.current.sheet?.kind).toBe('sanction');
  });

  // After an interruption: a card arrives while the disqualification's ending waits. Under a card the pad takes no tap
  // (`withCard`), so the prompt that records the ending goes with the tools, and is back on the pad.
  it.each(['viewOnly', 'updateNeeded', 'resultRecorded', 'notStarted', 'linkInvalid'] as const)(
    'hides the ending prompt under the %s card; back on the pad, it waits again',
    (card) => {
      const fakes = createFakePorts();
      const view = mount(fakes);
      disqualify(view, fakes);
      expect(view.result.current.sheet).toEqual(PROMPT);
      act(() => view.result.current.actions.pick(card));
      expect(view.result.current.sheet).toBeNull();
      act(() => view.result.current.actions.pick('pad'));
      expect(view.result.current.sheet).toEqual(PROMPT);
    },
  );

  // A second call on the ending prompt's buttons: the second finds no ending waiting, records nothing, and says so.
  it('records the ending once for a second tap on Record the ending', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    disqualify(view, fakes);
    act(() => view.result.current.actions.recordEnding());
    const ended = view.result.current.view;
    // Within the window it is the same tap (review M1): "Counted once", never a refusal over the ending recorded.
    act(() => view.result.current.actions.recordEnding());
    expect(view.result.current.view).toBe(ended);
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    // A moment later nothing waits: refused, and nothing recorded.
    aSecondOn(fakes);
    act(() => view.result.current.actions.recordEnding());
    expect(view.result.current.view).toBe(ended);
    expect(view.result.current.line).toEqual(refusal('scoring.refusal.notNow'));
  });

  it('voids the disqualification once for a second tap on Void: the rally before it stays', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    act(() => view.result.current.actions.tapHalf('first'));
    disqualify(view, fakes);
    act(() => view.result.current.actions.voidSanction());
    act(() => view.result.current.actions.voidSanction());
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(points(view)).toEqual(['1', '0']);
    expect(view.result.current.sheet).toBeNull();
    expect(view.result.current.view.halves[1]?.sub).toBeNull();
  });

  it('closes History when the preview row picks a state, as Match details', () => {
    const view = mount();
    act(() => view.result.current.actions.history());
    expect(view.result.current.sheet?.kind).toBe('history');
    act(() => view.result.current.actions.pick('start'));
    expect(view.result.current.sheet).toBeNull();
  });

  it('finds the Start screen with no pick on a return: the pick is the screen’s, the match the app’s', () => {
    const fakes = createFakePorts();
    const first = mount(fakes, { notStarted: true });
    act(() => first.result.current.actions.pickServer('second'));
    first.unmount();
    const again = mount(fakes, { notStarted: true });
    expect(again.result.current.view.start).not.toBeNull();
    expect(again.result.current.toss).toBeNull();
  });
});

// The coordinator's ruling (2026-11-01): ending a match is the costliest mistake on the pad. A sheet's steps and the
// ending prompt stand on the bottom edge, so the second tap of a double tap on one step's button lands on the next
// step's. Within the bounce window (`bounce.ts`) of a step appearing, its buttons do nothing, and say nothing: the step
// still waits, and the line is behind the dim.
describe('useBadmintonPadPreview, a sheet step that has just appeared', () => {
  /** The sheet up: a sanction step names itself by its title's key (level, who, confirm). */
  const step = (view: ReturnType<typeof mount>) => view.result.current.sheet;
  const choose = (view: ReturnType<typeof mount>, id: string) =>
    act(() => view.result.current.actions.choose(id));
  /** Sanction on L. Chen opened at `t`, the level and the person chosen a second apart: the confirm step up at t+2 s. */
  const toConfirm = (view: ReturnType<typeof mount>, fakes: FakePorts, t: number) => {
    at(fakes, t);
    act(() => view.result.current.actions.tool('sanction.second'));
    at(fakes, t + 1000);
    choose(view, 'disqualification');
    at(fakes, t + 2000);
    choose(view, '0');
  };

  it('ignores a level within the bounce window of the tool tap that opened the sheet', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, 0);
    act(() => view.result.current.actions.tool('sanction.second'));
    at(fakes, 249);
    choose(view, 'penalty');
    expect(step(view)).toMatchObject({
      kind: 'sanction',
      sheet: { title: { key: 'scoring.sanction.title' } },
    });
    at(fakes, 250);
    choose(view, 'penalty');
    expect(step(view)).toMatchObject({
      kind: 'sanction',
      sheet: { title: { key: 'scoring.sanction.who' } },
    });
  });

  it('ignores a person within the window of the step that asked for one: no penalty recorded, then it is', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, 0);
    act(() => view.result.current.actions.tool('sanction.second'));
    at(fakes, 1000);
    choose(view, 'penalty');
    at(fakes, 1249);
    choose(view, '0');
    expect(step(view)).toMatchObject({
      kind: 'sanction',
      sheet: { title: { key: 'scoring.sanction.who' } },
    });
    expect(view.result.current.view.halves[1]?.sub).toBeNull();
    expect(view.result.current.line).toBeNull();
    at(fakes, 1250);
    choose(view, '0');
    expect(step(view)).toBeNull();
    expect(view.result.current.view.halves[1]?.sub).toEqual({ key: 'scoring.sanction.penalty' });
  });

  it('ignores the confirm within the window of the confirm step: no disqualification, then it is', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    toConfirm(view, fakes, 0);
    at(fakes, 2249);
    choose(view, 'confirm');
    expect(step(view)).toMatchObject({
      kind: 'sanction',
      sheet: { title: { key: 'scoring.sanction.confirm.title' } },
    });
    at(fakes, 2250);
    choose(view, 'confirm');
    expect(step(view)).toEqual({ kind: 'ending', person: 'L. Chen' });
  });

  it.each([
    ['Record the ending', 'recordEnding'],
    ['Void', 'voidSanction'],
  ] as const)(
    'ignores %s within the window of the ending prompt appearing; a moment later it acts',
    (_name, action) => {
      const fakes = createFakePorts();
      const view = mount(fakes);
      toConfirm(view, fakes, 0);
      at(fakes, 3000);
      choose(view, 'confirm');
      at(fakes, 3249);
      act(() => view.result.current.actions[action]());
      expect(step(view)).toEqual({ kind: 'ending', person: 'L. Chen' });
      expect(view.result.current.line).toBeNull();
      at(fakes, 3250);
      act(() => view.result.current.actions[action]());
      expect(step(view)).toBeNull();
    },
  );

  it('quiets the prompt again when an Undo of the ending brings it back', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    toConfirm(view, fakes, 0);
    at(fakes, 3000);
    choose(view, 'confirm');
    at(fakes, 4000);
    act(() => view.result.current.actions.recordEnding());
    at(fakes, 5000);
    act(() => view.result.current.actions.undo());
    expect(step(view)).toEqual({ kind: 'ending', person: 'L. Chen' });
    at(fakes, 5100);
    act(() => view.result.current.actions.recordEnding());
    expect(step(view)).toEqual({ kind: 'ending', person: 'L. Chen' });
    at(fakes, 5250);
    act(() => view.result.current.actions.recordEnding());
    expect(step(view)).toBeNull();
  });
});

// Review I1 (2026-11-01): a sheet's button that records leaves the screen with its sheet, and the second touch of a
// double tap on it lands on what was under it: a tool, Undo or a half. Each such button opens the bounce window for
// every tap of the pad, as Start match does; Set score's Confirm also waits out the window of its sheet appearing.
describe('useBadmintonPadPreview, a sheet button that records opens the bounce window', () => {
  const T = 10_000;
  type View = ReturnType<typeof mount>;
  const sub = (view: View) => view.result.current.view.halves[1]?.sub ?? null;
  /** L. Chen disqualified from `t`, a step a second: the ending prompt up at t+3 s. */
  const disqualifyAt = (view: View, fakes: FakePorts, t: number) => {
    at(fakes, t);
    act(() => view.result.current.actions.tool('sanction.second'));
    ['disqualification', '0', 'confirm'].forEach((choice, step) => {
      at(fakes, t + (step + 1) * 1000);
      act(() => view.result.current.actions.choose(choice));
    });
  };
  /** Set score opened at T and confirmed at T+1 s at 5-3. */
  const setScoreAt = (view: View, fakes: FakePorts) => {
    at(fakes, T);
    act(() => view.result.current.actions.tool('setScore'));
    at(fakes, T + 1000);
    act(() => view.result.current.actions.saveScore('5', '3'));
  };

  it('ignores Set score’s Confirm within the window of its sheet appearing; a moment later it sets the score', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, T);
    act(() => view.result.current.actions.tool('setScore'));
    at(fakes, T + 249);
    act(() => view.result.current.actions.saveScore('5', '3'));
    expect(view.result.current.sheet?.kind).toBe('setScore');
    expect(points(view)).toEqual(['0', '0']);
    at(fakes, T + 250);
    act(() => view.result.current.actions.saveScore('5', '3'));
    expect(view.result.current.sheet).toBeNull();
    expect(points(view)).toEqual(['5', '3']);
  });

  it.each([
    [
      'the Set score tool',
      (view: View) => view.result.current.actions.tool('setScore'),
      (view: View) => expect(view.result.current.sheet?.kind).toBe('setScore'),
    ],
    [
      'Undo',
      (view: View) => view.result.current.actions.undo(),
      (view: View) => expect(points(view)).toEqual(['0', '0']),
    ],
    [
      'a half',
      (view: View) => view.result.current.actions.tapHalf('first'),
      (view: View) => expect(points(view)).toEqual(['6', '3']),
    ],
  ] as const)(
    'counts %s within the window of Set score’s Confirm once; a moment later it acts',
    (_what, tap, acted) => {
      const fakes = createFakePorts();
      const view = mount(fakes);
      setScoreAt(view, fakes);
      at(fakes, T + 1249);
      act(() => tap(view));
      expect(view.result.current.line).toEqual(COUNTED_ONCE);
      expect(view.result.current.sheet).toBeNull();
      expect(points(view)).toEqual(['5', '3']);
      at(fakes, T + 1250);
      act(() => tap(view));
      acted(view);
    },
  );

  it('counts Undo within the window of a sanction’s person once: the warning stands; a moment later it goes', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, T);
    act(() => view.result.current.actions.tool('sanction.second'));
    at(fakes, T + 1000);
    act(() => view.result.current.actions.choose('warning'));
    at(fakes, T + 2000);
    act(() => view.result.current.actions.choose('0'));
    expect(sub(view)).toEqual({ key: 'scoring.sanction.warning' });
    at(fakes, T + 2249);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(sub(view)).toEqual({ key: 'scoring.sanction.warning' });
    at(fakes, T + 2250);
    act(() => view.result.current.actions.undo());
    expect(sub(view)).toBeNull();
  });

  it('counts Undo within the window of Record the ending once: the match stays ended; a moment later it reopens', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    disqualifyAt(view, fakes, T);
    at(fakes, T + 4000);
    act(() => view.result.current.actions.recordEnding());
    expect(view.result.current.view.lastTap?.text.key).toBe('scoring.badminton.last.ending');
    at(fakes, T + 4249);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(view.result.current.sheet).toBeNull();
    at(fakes, T + 4250);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.sheet).toEqual({ kind: 'ending', person: 'L. Chen' });
  });

  it('counts Undo within the window of Void once: the rally before stands; a moment later it goes', () => {
    const fakes = createFakePorts();
    const view = mount(fakes);
    at(fakes, T - 5000);
    act(() => view.result.current.actions.tapHalf('first'));
    disqualifyAt(view, fakes, T);
    at(fakes, T + 4000);
    act(() => view.result.current.actions.voidSanction());
    expect(view.result.current.sheet).toBeNull();
    at(fakes, T + 4249);
    act(() => view.result.current.actions.undo());
    expect(view.result.current.line).toEqual(COUNTED_ONCE);
    expect(points(view)).toEqual(['1', '0']);
    at(fakes, T + 4250);
    act(() => view.result.current.actions.undo());
    expect(points(view)).toEqual(['0', '0']);
  });
});
