import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import type { PadText, PadVar, PadView } from '@/domain/scoring/padView';
import { volleyballPad, withHeldServing } from '@/domain/scoring/volleyballPad';
import type { VolleyballPadKey } from '@/domain/scoring/volleyballTypes';
import {
  BEACH,
  INDOOR,
  queuedOf,
  rally,
  sanction,
  start,
  sub,
  summary,
  timeout,
  voiding,
  withCfg,
} from '../../../test/volleyballLedger';
import { LIVE, displayOf, padOf, wonSet } from './volleyballPad.testkit';

// S2-6 Task 6 (spec §5, layout A, ruling 178): the pad is a pure reading of the display. Every expected word is a
// dictionary key with its fills, written out from the spec's copy; the displays come from folding real ledgers.

const first = (view: PadView<VolleyballPadKey>) => view.halves[0];
const second = (view: PadView<VolleyballPadKey>) => view.halves[1];

describe('volleyballPad: the foot (ruling 175)', () => {
  it('says each side’s timeouts and subs in the set against FIVB’s numbers', () => {
    const view = padOf([
      ...LIVE,
      timeout('H'),
      sub('H'),
      sub('H'),
      sub('H'),
      sub('H'),
      timeout('A'),
    ]);
    expect(first(view).foot).toEqual({
      text: {
        key: 'scoring.volleyball.foot.indoor',
        vars: { timeouts: 1, timeoutCap: 2, subs: 4, subCap: 6 },
      },
      said: {
        key: 'scoring.volleyball.foot.indoorSaid',
        vars: { timeouts: 1, timeoutCap: 2, subs: 4, subCap: 6 },
      },
      place: 'slot',
      caution: false,
    });
    expect(second(view).foot?.text).toEqual({
      key: 'scoring.volleyball.foot.indoor',
      vars: { timeouts: 1, timeoutCap: 2, subs: 0, subCap: 6 },
    });
  });

  // The slot beside Tap holds only so many boxes and the labelled words (volleyballFit.test.ts): from three finished sets the
  // counts are numbers alone, and the spoken words stay in full.
  it('drops its labels from the third finished set on, and still speaks them in full', () => {
    const two = padOf([...LIVE, ...wonSet('H').slice(1), ...wonSet('A', 'A')]);
    expect(first(two).foot?.text).toMatchObject({ key: 'scoring.volleyball.foot.indoor' });
    const three = padOf([
      ...LIVE,
      ...wonSet('H').slice(1),
      ...wonSet('A', 'A'),
      ...wonSet('H', 'H'),
    ]);
    expect(first(three).foot?.text).toMatchObject({ key: 'scoring.volleyball.foot.indoorShort' });
    expect(first(three).foot?.said).toMatchObject({ key: 'scoring.volleyball.foot.indoorSaid' });
  });

  it('has no foot where the match records no timeouts (an empty input)', () => {
    const noTimeouts = withCfg(INDOOR, {
      records: { timeouts: false, sanctions: true, substitutions: true, expedite: false },
    });
    expect(first(padOf(LIVE, { bootstrap: noTimeouts })).foot).toBeNull();
    expect(first(padOf(LIVE)).foot).not.toBeNull();
  });

  it('turns caution at the second timeout and not at the first', () => {
    expect(first(padOf([...LIVE, timeout('H')])).foot?.caution).toBe(false);
    expect(first(padOf([...LIVE, timeout('H'), timeout('H')])).foot?.caution).toBe(true);
  });

  it('turns caution at the sixth sub and not at the fifth', () => {
    const subs = (n: number) => Array.from({ length: n }, () => sub('H'));
    expect(first(padOf([...LIVE, ...subs(5)])).foot?.caution).toBe(false);
    expect(first(padOf([...LIVE, ...subs(6)])).foot?.caution).toBe(true);
  });

  it('stays caution past the number: the next one is shown, never refused', () => {
    expect(first(padOf([...LIVE, timeout('H'), timeout('H'), timeout('H')])).foot?.caution).toBe(
      true,
    );
  });

  it('is the other side’s own: one side at its number does not colour the other', () => {
    const view = padOf([...LIVE, timeout('H'), timeout('H')]);
    expect([first(view).foot?.caution, second(view).foot?.caution]).toEqual([true, false]);
  });

  it('counts the set under way: a new set starts again from none', () => {
    const view = padOf([...LIVE, timeout('H'), timeout('H'), ...wonSet('H').slice(1)]);
    expect(first(view).foot?.caution).toBe(false);
    expect(first(view).foot?.text).toEqual({
      key: 'scoring.volleyball.foot.indoor',
      vars: { timeouts: 0, timeoutCap: 2, subs: 0, subCap: 6 },
    });
  });

  it('beach: one timeout, no subs, caution at the one', () => {
    const live = [start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })];
    expect(first(padOf(live, { bootstrap: BEACH })).foot).toEqual({
      text: { key: 'scoring.volleyball.foot.beach', vars: { timeouts: 0, timeoutCap: 1 } },
      said: { key: 'scoring.volleyball.foot.beachSaid', vars: { timeouts: 0, timeoutCap: 1 } },
      place: 'line',
      caution: false,
    });
    expect(first(padOf([...live, timeout('H')], { bootstrap: BEACH })).foot?.caution).toBe(true);
  });

  it('is none before the start and once the match is decided', () => {
    expect(first(padOf([])).foot).toBeNull();
    const decided = padOf([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')]);
    expect([first(decided).foot, second(decided).foot]).toEqual([null, null]);
  });
});

describe('volleyballPad: the card of the set’s heaviest sanction', () => {
  const marks = (level: string | null) =>
    first(padOf(level === null ? LIVE : [...LIVE, sanction('H', level)])).marks;

  it('a warning is the yellow card, said as the level', () => {
    expect(marks('warning')).toEqual({
      clock: false,
      cards: ['caution'],
      said: [{ key: 'scoring.sanction.warning' }],
    });
  });

  it.each(['penalty', 'expulsion', 'disqualification'] as const)(
    '%s is the red card, said as the level',
    (level) => {
      expect(marks(level)).toEqual({
        clock: false,
        cards: ['dismissal'],
        said: [{ key: `scoring.sanction.${level}` }],
      });
    },
  );

  it('none when the side holds none, and the other side’s card is not this one’s', () => {
    expect(marks(null).cards).toEqual([]);
    expect(second(padOf([...LIVE, sanction('H', 'penalty')])).marks.cards).toEqual([]);
  });

  it('the heavier replaces the lighter', () => {
    const view = padOf([...LIVE, sanction('H', 'warning'), sanction('H', 'penalty')]);
    expect(first(view).marks.cards).toEqual(['dismissal']);
  });

  it('a set after the one it was given in starts clean', () => {
    const view = padOf([...LIVE, sanction('H', 'penalty'), ...wonSet('H').slice(1)]);
    expect(first(view).marks.cards).toEqual([]);
  });
});

describe('volleyballPad: the halves', () => {
  it('draws the sides as typed, the set’s points, and the serving plate on the serving side only', () => {
    const view = padOf([...LIVE, rally({ wonBy: 'A' })]);
    expect([first(view).value, second(view).value]).toEqual(['1', '1']);
    expect([first(view).serving, second(view).serving]).toEqual([
      null,
      { shown: { key: 'scoring.volleyball.serving' }, said: { key: 'scoring.volleyball.serving' } },
    ]);
    expect([first(view).bar, second(view).bar]).toEqual(['dim', 'lit']);
    expect([first(view).tappable, second(view).tappable]).toEqual([true, true]);
  });

  it('names no server at the deciding set’s toss: no plate, both bars dim', () => {
    const toss = padOf([
      start(),
      ...wonSet('H', 'H'),
      ...wonSet('A'),
      ...wonSet('H'),
      ...wonSet('A'),
    ]);
    expect([first(toss).serving, second(toss).serving]).toEqual([null, null]);
    expect([first(toss).bar, second(toss).bar]).toEqual(['dim', 'dim']);
  });

  it('beach names the server on the serving side’s half', () => {
    const view = padOf([start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })], {
      bootstrap: BEACH,
    });
    expect(first(view).sub).toEqual({
      key: 'scoring.volleyball.serverPerson',
      vars: { person: 'Sand / Surf h1' },
    });
    expect(second(view).sub).toBeNull();
  });

  it('indoor names the serving side only: no person line', () => {
    expect(first(padOf(LIVE)).sub).toBeNull();
  });

  it('shows each finished set in its box, the winner’s marked, and says them', () => {
    const view = padOf([start(), ...wonSet('H', 'H'), ...wonSet('A')]);
    expect(first(view).periods).toEqual({
      scores: [
        { value: '25', won: true },
        { value: '0', won: false },
      ],
      said: [{ key: 'scoring.volleyball.setsSaid.other', count: 2, vars: { scores: '25, 0' } }],
    });
    expect(first(padOf(LIVE)).periods).toBeNull();
  });

  it('tallies the sets won, top first', () => {
    const view = padOf([start(), ...wonSet('H', 'H'), ...wonSet('A'), ...wonSet('H')]);
    expect(view.tally.shown).toBe('2:1');
  });

  it('takes no tap before the start or once decided', () => {
    expect(first(padOf([])).tappable).toBe(false);
    const decided = padOf([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')]);
    expect([first(decided).tappable, second(decided).tappable]).toEqual([false, false]);
    expect(decided.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
  });
});

describe('volleyballPad: the strip, from the engine’s rules', () => {
  const strip = (...args: Parameters<typeof padOf>) => padOf(...args).strip;

  it('says the set of how many and its target, and no note below the endgame', () => {
    expect(strip(LIVE)).toEqual([
      { slot: 'set', text: { key: 'scoring.volleyball.setOf', vars: { set: 1, bestOf: 5 } } },
      { slot: 'target', text: { key: 'scoring.volleyball.target', vars: { target: 25 } } },
      { slot: 'note', text: null },
    ]);
  });

  it('the deciding set is to 15', () => {
    const toss = [start(), ...wonSet('H', 'H'), ...wonSet('A'), ...wonSet('H'), ...wonSet('A')];
    expect(strip(toss)[1]).toEqual({
      slot: 'target',
      text: { key: 'scoring.volleyball.target', vars: { target: 15 } },
    });
    expect(strip(toss)[0]?.text).toEqual({
      key: 'scoring.volleyball.setOf',
      vars: { set: 5, bestOf: 5 },
    });
  });

  it('beach is a best of 3 to 21', () => {
    const view = strip([start()], { bootstrap: BEACH });
    expect([view[0]?.text, view[1]?.text]).toEqual([
      { key: 'scoring.volleyball.setOf', vars: { set: 1, bestOf: 3 } },
      { key: 'scoring.volleyball.target', vars: { target: 21 } },
    ]);
  });

  it('level in the endgame it says win by 2', () => {
    const level = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      ...Array.from({ length: 23 }, () => rally({ wonBy: 'H' })),
      ...Array.from({ length: 24 }, () => rally({ wonBy: 'A' })),
    ];
    expect(strip(level)[2]).toEqual({
      slot: 'note',
      text: { key: 'scoring.volleyball.note.setting', vars: { winBy: 2 } },
    });
  });

  it('a win-by-one set at its endgame says the next point wins', () => {
    const goldenCfg = { ...BEACH, cfg: { winBy: 1 } };
    const to = 25;
    const level = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      ...Array.from({ length: to - 2 }, () => rally({ wonBy: 'H' })),
      ...Array.from({ length: to - 1 }, () => rally({ wonBy: 'A' })),
    ];
    expect(strip(level, { bootstrap: { ...goldenCfg, cfg: { winBy: 1 } } })[2]?.text).toEqual({
      key: 'scoring.volleyball.note.goldenPoint',
    });
  });

  it('says only the set once decided: no target, no note', () => {
    const decided = [start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')];
    expect(strip(decided).map((item) => item.text !== null)).toEqual([true, false, false]);
  });
});

describe('volleyballPad: the Start screen and the last tap', () => {
  it('before the start asks who serves first, the sides top first, and shows no tools', () => {
    const view = padOf([]);
    expect(view.start?.ask).toEqual({ key: 'scoring.volleyball.start.ask' });
    expect(view.start?.sides.map((side) => side.label)).toEqual([
      expect.stringContaining('Falcons'),
      expect.stringContaining('Herons'),
    ]);
    expect(view.tools).toEqual([]);
    expect(view.lastTap).toBeNull();
  });

  it('once started there is no question', () => {
    expect(padOf([start()]).start).toBeNull();
  });

  it('says the last record in words, and offers Undo for a tap of this phone’s own', () => {
    const queued = [queuedOf('q1', timeout('A'))];
    const view = padOf(LIVE, { queued });
    expect(view.lastTap).toEqual({
      text: {
        key: 'scoring.volleyball.last.timeout',
        vars: { side: expect.stringContaining('Herons') },
      },
      undo: true,
    });
  });

  it('says what Undo took back', () => {
    const view = padOf([...LIVE, timeout('A'), voiding(3)]);
    expect(view.lastTap?.text).toEqual({
      key: 'scoring.volleyball.undone.timeout',
      vars: { side: expect.stringContaining('Herons') },
    });
  });

  it('a set score says its score', () => {
    expect(padOf([start(), summary(12, 9)]).lastTap?.text).toEqual({
      key: 'scoring.volleyball.last.setScore',
      vars: { score: '12–9' },
    });
  });
});

describe('withHeldServing: the toss answer held for the next rally (ruling 180)', () => {
  const toss = [start(), ...wonSet('H', 'H'), ...wonSet('A'), ...wonSet('H'), ...wonSet('A')];

  it('says who is serving next while the question stands, keeping the rest of the view', () => {
    const display = displayOf(toss);
    const view = volleyballPad(display);
    const held = withHeldServing(view, 'second', display);
    expect(held.lastTap?.text).toEqual({
      key: 'scoring.volleyball.held',
      vars: { side: expect.stringContaining('Herons') },
    });
    expect({ ...held, lastTap: null }).toEqual({ ...view, lastTap: null });
  });

  it('changes nothing with no answer held, or when no answer is asked for', () => {
    const display = displayOf(toss);
    const view = volleyballPad(display);
    expect(withHeldServing(view, null, display)).toBe(view);
    const live = displayOf(LIVE);
    const liveView = volleyballPad(live);
    expect(withHeldServing(liveView, 'first', live)).toBe(liveView);
  });
});

describe('volleyballPad: every word it names is a dictionary key', () => {
  const collect = (value: PadVar<VolleyballPadKey> | undefined, into: Set<string>) => {
    if (value === undefined || typeof value !== 'object') return;
    into.add(value.key);
    for (const fill of Object.values(value.vars ?? {})) collect(fill, into);
  };

  it('each key in the views, in each phase and both variants, is in the English dictionary', () => {
    const scenarios = [
      padOf([]),
      padOf([start()]),
      padOf([...LIVE, timeout('H'), sanction('H', 'warning'), sub('H')]),
      padOf([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')]),
      padOf([start(), summary(10, 9)]),
      padOf([start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })], { bootstrap: BEACH }),
    ];
    const keys = new Set<string>();
    for (const view of scenarios) {
      const texts: (PadText<VolleyballPadKey> | null | undefined)[] = [
        view.tally.said,
        view.start?.ask,
        view.lastTap?.text,
        ...view.strip.map((item) => item.text),
        ...view.tools.flatMap((tool) => [tool.label, tool.said]),
        ...view.details.rules.flatMap((row) => [row.label, row.value]),
        ...view.halves.flatMap((half) => [
          half.hint,
          half.sub,
          half.serving?.shown,
          half.serving?.said,
          half.foot?.text,
          half.foot?.said,
          ...half.marks.said,
          ...(half.periods?.said ?? []),
        ]),
      ];
      for (const text of texts) collect(text ?? undefined, keys);
    }
    expect(keys.size).toBeGreaterThan(20);
    for (const key of keys) expect(Object.keys(en), key).toContain(key);
  });

  // Compile-time: the pad's keys are all `MessageKey`s (vitest does not typecheck; `tsc` does).
  it('is assignable to the kit’s MessageKey view', () => {
    const view: PadView<MessageKey> = padOf(LIVE);
    expect(view.halves).toHaveLength(2);
  });
});
