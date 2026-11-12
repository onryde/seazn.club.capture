import { describe, expect, it } from 'vitest';
import {
  parseVolleyballTool,
  volleyballMoreItems,
  volleyballMoreOptions,
  volleyballToolSlots,
  volleyballTools,
} from '@/domain/scoring/volleyballTools';
import { BEACH, INDOOR, start, summary, rally, withCfg } from '../../../test/volleyballLedger';
import { LIVE, displayOf, wonSet } from './volleyballPad.testkit';

// S2-6 Task 6 (ruling 178, layout A; F3): Timeout, Sub (indoor only), More, and Set score last, before a set's first rally.
// The row has fixed slots (indoor four, beach three) so a cell never moves when Set score goes; an indoor row draws Timeout
// short (it does not fit 48 dp at 320; `volleyballFit.test.ts`).

const ids = (...args: Parameters<typeof displayOf>) =>
  volleyballTools(displayOf(...args)).map((tool) => tool.id);

describe('volleyballTools: the row', () => {
  it('before the match starts there are none', () => {
    expect(ids([])).toEqual([]);
  });

  it('at 0-0 of a started match: Timeout, Sub, More, Set score last', () => {
    expect(ids([start()])).toEqual(['timeout', 'sub', 'more', 'setScore']);
  });

  it('after the first rally: Timeout, Sub, More (Set score is for a set’s first rally only)', () => {
    expect(ids(LIVE)).toEqual(['timeout', 'sub', 'more']);
  });

  it('between sets it is offered again: before the next set’s first rally', () => {
    expect(ids([start(), ...wonSet('H', 'H')])).toEqual(['timeout', 'sub', 'more', 'setScore']);
  });

  it('beach has no Sub: Timeout, More, Set score last, and after a rally Timeout, More', () => {
    expect(ids([start()], { bootstrap: BEACH })).toEqual(['timeout', 'more', 'setScore']);
    expect(
      ids([start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })], { bootstrap: BEACH }),
    ).toEqual(['timeout', 'more']);
  });

  it('a decided match has no tools', () => {
    expect(ids([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')])).toEqual([]);
  });

  it('a match that records no timeouts has no Timeout, none that records no sanctions has no More', () => {
    const noTimeouts = withCfg(INDOOR, {
      records: { timeouts: false, sanctions: true, substitutions: true, expedite: false },
    });
    const noSanctions = withCfg(INDOOR, {
      records: { timeouts: true, sanctions: false, substitutions: true, expedite: false },
    });
    expect(ids(LIVE, { bootstrap: noTimeouts })).toEqual(['sub', 'more']);
    expect(ids(LIVE, { bootstrap: noSanctions })).toEqual(['timeout', 'sub']);
  });

  it('Who serves? stands only mid-set when a lost pick must be asked for, and the row stays four', () => {
    const lost = [...LIVE, summary(10, 8)];
    expect(displayOf(lost).phase).toBe('live');
    expect(ids(lost)).toEqual(['timeout', 'sub', 'more', 'serving']);
  });

  it('at a set’s 0-0 the first tap asks the toss, so no cell stands for it (ruling 180)', () => {
    const twoAll = [start(), ...wonSet('H', 'H'), ...wonSet('A'), ...wonSet('H'), ...wonSet('A')];
    expect(displayOf(twoAll).anchorNeeded).toBe(true);
    expect(ids(twoAll)).toEqual(['timeout', 'sub', 'more', 'setScore']);
  });
});

describe('volleyballTools: fixed slots (F3)', () => {
  const tools = (...args: Parameters<typeof displayOf>) => volleyballTools(displayOf(...args));
  const slots = (...args: Parameters<typeof displayOf>) => volleyballToolSlots(displayOf(...args));

  it('indoor has four slots and beach three, before a rally, after it and mid-set', () => {
    for (const specs of [[start()], LIVE, [...LIVE, summary(10, 8)]]) expect(slots(specs)).toBe(4);
    for (const specs of [[start()], [start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })]])
      expect(slots(specs, { bootstrap: BEACH })).toBe(3);
  });

  it('Timeout, Sub and More are the same cells in the same order whether or not the last slot is taken', () => {
    const before = tools([start()]).map((tool) => tool.id);
    const after = tools(LIVE).map((tool) => tool.id);
    expect(before.slice(0, 3)).toEqual(['timeout', 'sub', 'more']);
    expect(after).toEqual(['timeout', 'sub', 'more']);
    expect(volleyballToolSlots(displayOf([start()]))).toBe(volleyballToolSlots(displayOf(LIVE)));
    // the cells' own words do not change either, so a cell's width never depends on its label
    expect(tools([start()]).slice(0, 3)).toEqual(tools(LIVE).slice(0, 3));
  });

  it('there is never a tool beyond the slots, and none is drawn before the start or once decided', () => {
    for (const specs of [[start()], LIVE, [...LIVE, summary(10, 8)]])
      expect(tools(specs).length).toBeLessThanOrEqual(slots(specs));
    expect(ids([])).toEqual([]);
  });
});

describe('volleyballTools: the words', () => {
  const tools = (...args: Parameters<typeof displayOf>) => volleyballTools(displayOf(...args));

  it('a row of four draws Timeout short and says it in full', () => {
    const timeout = tools([start()]).find((tool) => tool.id === 'timeout');
    expect(timeout?.label).toEqual({ key: 'scoring.volleyball.tool.timeoutShort' });
    expect(timeout?.said).toEqual({ key: 'scoring.volleyball.tool.timeout' });
  });

  it('an indoor row draws Timeout short before and after the first rally: its four slots never change', () => {
    const timeout = tools(LIVE).find((tool) => tool.id === 'timeout');
    expect(timeout?.label).toEqual({ key: 'scoring.volleyball.tool.timeoutShort' });
  });

  it('a beach row of three draws Timeout in full and adds nothing to say', () => {
    const timeout = tools(LIVE, { bootstrap: BEACH }).find((tool) => tool.id === 'timeout');
    expect(timeout?.label).toEqual({ key: 'scoring.volleyball.tool.timeout' });
    expect(timeout?.said).toBeUndefined();
  });

  it('Sub is drawn short and said in full: the full word does not fit a cell in French', () => {
    const sub = tools(LIVE).find((tool) => tool.id === 'sub');
    expect([sub?.label, sub?.said]).toEqual([
      { key: 'scoring.volleyball.tool.sub' },
      { key: 'scoring.volleyball.sheet.sub' },
    ]);
  });

  it('every cell is a plain usable outline with no second line', () => {
    for (const tool of tools([start()])) {
      expect([tool.detail, tool.kind, tool.enabled]).toEqual([null, 'standard', true]);
    }
  });
});

describe('parseVolleyballTool: the ids the row gives, read back', () => {
  it.each([
    ['setScore', { setScore: true }],
    ['timeout', { timeout: true }],
    ['sub', { sub: true }],
    ['more', { more: true }],
    ['serving', { serving: true }],
  ] as const)('%s', (id, parsed) => {
    expect(parseVolleyballTool(id)).toEqual(parsed);
  });

  it('anything else is null: an id of another sport, an empty one', () => {
    expect(parseVolleyballTool('expedite')).toBeNull();
    expect(parseVolleyballTool('returns.first')).toBeNull();
    expect(parseVolleyballTool('')).toBeNull();
  });
});

describe('volleyballMoreItems: the sanctions', () => {
  it('lists a Sanction for each side while the match is on, top first', () => {
    expect(volleyballMoreItems(displayOf(LIVE))).toEqual(['sanction.first', 'sanction.second']);
  });

  it('lists none before the start, once decided, or where the match records no sanctions', () => {
    expect(volleyballMoreItems(displayOf([]))).toEqual([]);
    expect(
      volleyballMoreItems(
        displayOf([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')]),
      ),
    ).toEqual([]);
    const none = withCfg(INDOOR, {
      records: { timeouts: true, sanctions: false, substitutions: true, expedite: false },
    });
    expect(volleyballMoreItems(displayOf(LIVE, { bootstrap: none }))).toEqual([]);
  });

  it('says each as "Sanction · {side}" with the side as typed', () => {
    expect(volleyballMoreOptions(displayOf(LIVE)).map((option) => option.label)).toEqual([
      {
        key: 'scoring.volleyball.more.sanction',
        vars: { side: expect.stringContaining('Falcons') },
      },
      {
        key: 'scoring.volleyball.more.sanction',
        vars: { side: expect.stringContaining('Herons') },
      },
    ]);
  });
});
