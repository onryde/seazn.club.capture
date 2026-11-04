import { describe, expect, it, vi } from 'vitest';

// The epoch is the engine's, asked for by the sport's own key (ruling 53; S2-1 learning, build 778: a literal here sent
// a stale epoch). Chess's is 5 today and badminton's and table tennis's 2, so the real engine already tells them apart;
// this stands in an engine that gives the board-game key an epoch of its own, and only a module that asks for
// 'boardgame' reads it.
vi.mock('@seazn/engine/sport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@seazn/engine/sport')>();
  return { ...real, foldEpochOf: (key: string) => (key === 'boardgame' ? 9 : 2) };
});

describe('chessSport.epoch', () => {
  it('is what the engine says for boardgame, not for chess by another name and not a number of ours', async () => {
    const { chessSport } = await import('@/domain/scoring/chessSport');
    expect(chessSport.epoch).toBe(9);
  });
});
