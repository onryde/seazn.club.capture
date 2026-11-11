import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (ruling 53; S2-1 learning, build 778: a literal here sent
// a stale epoch). Volleyball's is 1 today and no other sport's is, but a stand-in that gives every other sport a different
// number proves that only a module asking for 'volleyball' reads this one.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'volleyball' ? 9 : 2) };
});

describe('volleyballSport.epoch', () => {
  it('is what the engine says for volleyball, not for another sport and not a number of ours', async () => {
    const { volleyballSport } = await import('@/domain/scoring/volleyballSport');
    expect(volleyballSport.epoch).toBe(9);
  });
});
