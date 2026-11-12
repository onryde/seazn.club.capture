import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import { chessSport } from '@/domain/scoring/chessSport';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { footballSport } from '@/domain/scoring/footballSport';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import { tennisSport } from '@/domain/scoring/tennisSport';
import { volleyballSport } from '@/domain/scoring/volleyballSport';

// Every tap carries its sport's fold epoch, and the server's 426 gate refuses a write below its own (S2 ruling 8). The
// numbers are literals copied by hand from the engine's `fold-epoch` at the release this build pins (7.0.0), never read
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

  it('football 5: W2e T32 raised it to 4 (a lineup event is judged against football’s own pitch), 7.0.0 to 5 (extraTimeSubs)', () => {
    expect(foldEpochOf('football')).toBe(5);
    expect(footballSport.epoch).toBe(5);
  });

  // Literal 1, copied by hand; the Task 2 seeds read the engine's own number, so this is the one that can catch a bump.
  it('volleyball 1, as at engine 7.0.0', () => {
    expect(foldEpochOf('volleyball')).toBe(1);
    expect(volleyballSport.epoch).toBe(1);
  });

  // Literal 2, copied by hand from the release (W2e T4 raised it); Task 3's seeds read the engine's own number.
  it('tennis 3, as at engine 8.0.0 (the toss: tennis.toss seats the first server)', () => {
    expect(foldEpochOf('tennis')).toBe(3);
    expect(tennisSport.epoch).toBe(3);
  });
});
