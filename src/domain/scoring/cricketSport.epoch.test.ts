import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (S2 ruling 8; S2-1 learning, build 778: a literal here
// sent a stale epoch). This stands in an engine that gives cricket an epoch of its own, 9, and every other sport 2: only
// a module that asks for 'cricket' reads it.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'cricket' ? 9 : 2) };
});

describe('cricketSport.epoch', () => {
  it('is the engine’s for cricket, not another sport’s and not a number of ours', async () => {
    const { cricketSport } = await import('@/domain/scoring/cricketSport');
    expect(cricketSport.epoch).toBe(9);
  });
});
