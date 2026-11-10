import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { footballSport } from '@/domain/scoring/footballSport';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';

// Every tap carries its sport's fold epoch, and the server's 426 gate refuses a write below its own (S2 ruling 8). The
// numbers are literals copied by hand from the engine's `fold-epoch` at the release this build pins (6.0.2), never read
// back from the engine: an engine bump that moves an epoch fails here and is read on purpose.
describe('the engine’s epochs are the ones each sport sends', () => {
  it('badminton 2, table tennis 2 and chess (boardgame) 5, as at engine 2.0.0', () => {
    expect(badmintonSport.epoch).toBe(2);
    expect(tableTennisSport.epoch).toBe(2);
    expect(chessSport.epoch).toBe(5);
  });

  it('cricket 4: 4.0.0 raised it to 3 for the mid-over bowler change (phone ruling 75), 6.0.0 to 4 (CK-SO-4)', () => {
    expect(foldEpochOf('cricket')).toBe(4);
    expect(cricketSport.epoch).toBe(4);
  });

  it('football 4: W2e T32 raised it to 4 (a lineup event is judged against football’s own pitch), as at 6.0.2', () => {
    expect(foldEpochOf('football')).toBe(4);
    expect(footballSport.epoch).toBe(4);
  });
});
