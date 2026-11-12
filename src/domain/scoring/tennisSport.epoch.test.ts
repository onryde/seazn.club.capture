import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (ruling 53; S2-1 learning, build 778: a literal here sent
// a stale epoch). Tennis's is 2 today, as table tennis's and badminton's are, so a stand-in that gives every other sport a
// different number proves that only a module asking for 'tennis' reads this one.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'tennis' ? 9 : 2) };
});

describe('tennisSport.epoch', () => {
  it('is what the engine says for tennis, not for another sport and not a number of ours', async () => {
    const { tennisSport } = await import('@/domain/scoring/tennisSport');
    expect(tennisSport.epoch).toBe(9);
  });
});
