import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';

// Every tap carries its sport's fold epoch, and the server's 426 gate refuses a write below its own (S2 ruling 53). The
// numbers are literals copied from the engine's `src/sport/fold-epoch.ts` at the snapshot this build pins (engine PR #28,
// 44699f16), never read back from the engine: an engine bump that moves an epoch fails here and is read on purpose.
// Task 20 re-reads every literal from the release.
describe('the engine’s epochs are the ones each sport sends', () => {
  it('badminton 2, table tennis 2 and chess (boardgame) 5, as at engine 2.0.0', () => {
    expect(badmintonSport.epoch).toBe(2);
    expect(tableTennisSport.epoch).toBe(2);
    expect(chessSport.epoch).toBe(5);
  });

  it('cricket 3: the snapshot raised it for the mid-over bowler change (ruling 278)', () => {
    expect(foldEpochOf('cricket')).toBe(3);
  });
});
