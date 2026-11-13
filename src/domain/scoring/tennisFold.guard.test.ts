import { describe, expect, it, vi } from 'vitest';
import { start } from '../../../test/tennisLedger';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';

// S2-7 Task 4 (the controller's ruling): a `tennisPadRules` member throws on a config the schema would refuse, and the
// schema accepts configs the write path refuses, so the engine's pad rules must never throw out of the fold. Here the
// rules throw for every state; the fold still answers, and says what it cannot read as its quiet answer.

vi.mock('@seazn/engine/pad', async (importActual) => {
  const actual = await importActual<typeof import('@seazn/engine/pad')>();
  return {
    ...actual,
    tennisPadRules: {
      ...actual.tennisPadRules,
      endsChanged: () => {
        throw new Error('the engine cannot read this config');
      },
    },
  };
});

describe('a pad rule that throws', () => {
  it('leaves the fold standing, and the ends are not said to have changed', () => {
    const shown = display([start(), ...gamesOf('H')]);
    expect(shown.games).toEqual({ first: 1, second: 0 });
    expect(shown.endsChanged).toBe(false);
  });
});
