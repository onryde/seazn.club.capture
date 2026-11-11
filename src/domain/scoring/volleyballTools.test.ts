import { describe, expect, it } from 'vitest';
import {
  parseVolleyballTool,
  volleyballMoreItems,
  volleyballMoreOptions,
  volleyballTools,
} from '@/domain/scoring/volleyballTools';
import { BEACH, INDOOR, start, summary, rally, withCfg } from '../../../test/volleyballLedger';
import { LIVE, displayOf, wonSet } from './volleyballPad.testkit';

// S2-6 Task 6 (ruling 178, layout A): Set score before a set's first rally, Timeout, Sub (indoor only) and More. The row is
// never wider than four, and a row of four draws Timeout short (it does not fit 48 dp at 320; `volleyballFit.test.ts`).

const ids = (...args: Parameters<typeof displayOf>) =>
  volleyballTools(displayOf(...args)).map((tool) => tool.id);

describe('volleyballTools: the row', () => {
  it('before the match starts there are none', () => {
    expect(ids([])).toEqual([]);
  });

  it('at 0-0 of a started match: Set score, Timeout, Sub, More', () => {
    expect(ids([start()])).toEqual(['setScore', 'timeout', 'sub', 'more']);
  });

  it('after the first rally: Timeout, Sub, More (Set score is for a set’s first rally only)', () => {
    expect(ids(LIVE)).toEqual(['timeout', 'sub', 'more']);
  });

  it('between sets it is offered again: before the next set’s first rally', () => {
    expect(ids([start(), ...wonSet('H', 'H')])).toEqual(['setScore', 'timeout', 'sub', 'more']);
  });

  it('beach has no Sub: Set score, Timeout, More, and after a rally Timeout, More', () => {
    expect(ids([start()], { bootstrap: BEACH })).toEqual(['setScore', 'timeout', 'more']);
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
    expect(ids(lost)).toEqual(['serving', 'timeout', 'sub', 'more']);
  });

  it('at a set’s 0-0 the first tap asks the toss, so no cell stands for it (ruling 180)', () => {
    const twoAll = [start(), ...wonSet('H', 'H'), ...wonSet('A'), ...wonSet('H'), ...wonSet('A')];
    expect(displayOf(twoAll).anchorNeeded).toBe(true);
    expect(ids(twoAll)).toEqual(['setScore', 'timeout', 'sub', 'more']);
  });
});

describe('volleyballTools: the words', () => {
  const tools = (...args: Parameters<typeof displayOf>) => volleyballTools(displayOf(...args));

  it('a row of four draws Timeout short and says it in full', () => {
    const timeout = tools([start()]).find((tool) => tool.id === 'timeout');
    expect(timeout?.label).toEqual({ key: 'scoring.volleyball.tool.timeoutShort' });
    expect(timeout?.said).toEqual({ key: 'scoring.volleyball.tool.timeout' });
  });

  it('a row of three draws Timeout in full and adds nothing to say', () => {
    const timeout = tools(LIVE).find((tool) => tool.id === 'timeout');
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
