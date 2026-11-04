import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (ruling 53; S2-1 learning, build 778: a literal here sent
// a stale epoch). Badminton's and table tennis's are both 2 today, so the real engine cannot tell the sport asked for
// from another: this stands in an engine that gives table tennis an epoch of its own, and only a module that asks for
// 'tabletennis' reads it.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'tabletennis' ? 7 : 2) };
});

describe('tableTennisSport.epoch', () => {
  it('is what the engine says for table tennis, not for badminton and not a number of ours', async () => {
    const { tableTennisSport } = await import('@/domain/scoring/tableTennisSport');
    expect(tableTennisSport.epoch).toBe(7);
  });
});
