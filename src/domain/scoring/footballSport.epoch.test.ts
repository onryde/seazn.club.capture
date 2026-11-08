import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (ruling 53; S2-1 learning, build 778: a literal here sent
// a stale epoch). This stands in an engine that gives football an epoch no other sport has, and only a module that asks
// for 'football' reads it.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'football' ? 9 : 2) };
});

describe('footballSport.epoch', () => {
  it('is what the engine says for football, not for another sport and not a number of ours', async () => {
    const { footballSport } = await import('@/domain/scoring/footballSport');
    expect(footballSport.epoch).toBe(9);
  });
});
