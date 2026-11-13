import { describe, expect, it } from 'vitest';
import { tennisPad } from '@/domain/scoring/tennisPad';
import { display, gamesOf } from './tennisFold.testkit';
import { forfeit, points, sanction, start } from '../../../test/tennisLedger';

// The call on a half (owner, 2026-11-13): the pad puts each side's call on ITS half, only while the half takes a tap. The
// calls themselves are `tennisPointCall.test.ts`'s. Top half = home, who serves game 1.

const halves = (specs: Parameters<typeof display>[0]) => tennisPad(display(specs)).halves;
const calls = (specs: Parameters<typeof display>[0]) =>
  halves(specs).map((half) => half.call?.text ?? null);

describe('tennisPad: a call on the half it belongs to', () => {
  it('puts break point on the receiver’s half (the bottom: home serves) and nothing on the server’s', () => {
    expect(calls([start(), ...points('HAHAA')])).toEqual([
      null,
      { key: 'scoring.pad.call.breakPoint' },
    ]);
  });

  it('puts set point and match point on the half whose point wins them', () => {
    const lead = [start(), ...gamesOf('HHHHHH'), ...gamesOf('HHHHH')];
    expect(calls([...lead, ...points('HHH')])).toEqual([
      { key: 'scoring.pad.call.matchPoint' },
      null,
    ]);
    const setOnly = [start(), ...gamesOf('HHHHH'), ...points('HHH')];
    expect(calls(setOnly)).toEqual([{ key: 'scoring.pad.call.setPoint' }, null]);
  });

  it('says the call in the half’s name for a screen reader, the same words', () => {
    const [top, bottom] = halves([start(), ...points('HAHAA')]);
    expect(top?.call).toBeNull();
    expect(bottom?.call).toEqual({
      text: { key: 'scoring.pad.call.breakPoint' },
      said: { key: 'scoring.pad.call.breakPoint' },
    });
  });

  it('puts no plate on a half that takes no tap: a decided or ended match, a waiting default, before the start', () => {
    expect(calls([])).toEqual([null, null]);
    expect(calls([start(), ...gamesOf('HHHHHHHHHHHH')])).toEqual([null, null]);
    expect(calls([start(), ...points('HAHAA'), forfeit('H', 'retired')])).toEqual([null, null]);
    expect(calls([start(), ...points('HAHAA'), sanction('H', 'default')])).toEqual([null, null]);
  });

  it('draws no plate on a half that takes no tap even when the display names a call (the pad’s own check)', () => {
    const named = { first: 'match', second: 'break' } as const;
    for (const specs of [[], [start(), ...gamesOf('HHHHHHHHHHHH')]]) {
      const view = tennisPad({ ...display(specs), calls: named });
      expect(view.halves.map((half) => half.call ?? null)).toEqual([null, null]);
    }
    const live = tennisPad({ ...display([start()]), calls: named });
    expect(live.halves.map((half) => half.call?.text ?? null)).toEqual([
      { key: 'scoring.pad.call.matchPoint' },
      { key: 'scoring.pad.call.breakPoint' },
    ]);
  });

  it('puts none under a card laid over a live pad (the half takes no tap there)', async () => {
    const { withCard } = await import('@/domain/scoring/padView');
    const view = tennisPad(display([start(), ...points('HAHAA')]));
    expect(view.halves[1]?.call).not.toBeNull();
    const under = withCard(view, {
      kind: 'resultRecorded',
      undoLeft: null,
      title: { key: 'scoring.tennis.final' },
    });
    expect(under.halves.map((half) => [half.tappable, half.call ?? null])).toEqual([
      [false, null],
      [false, null],
    ]);
  });
});
