import { describe, expect, it } from 'vitest';
import { badmintonSport } from '@/domain/scoring/badmintonSport';
import {
  GAME_ONE_21_15 as GAME_ONE,
  GAME_TWO_21_18 as GAME_TWO,
  SINGLES,
  forfeit,
  ledgerOf,
  rallies,
  rally,
  sanction,
  start,
  type Spec,
} from '../../../test/badmintonLedger';

// What a finished match is called on Home's card ("Finished · 21–15, 21–18"; owner ruling 41, 2026-11-02): the sport's
// own line, from its folded display. Every expected line is written out by hand from the rules of badminton.

function displayOf(specs: readonly Spec[]) {
  const fold = badmintonSport.fold({
    bootstrap: SINGLES,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
  return fold.display;
}

describe('badmintonSport.resultLine', () => {
  it('says nothing before a game is over, however many points are on the board', () => {
    expect(badmintonSport.resultLine(displayOf([]))).toBe('');
    expect(badmintonSport.resultLine(displayOf([start(), ...rallies('HAH')]))).toBe('');
  });

  it('says the games over, the top side first, each as its two scores and joined by a comma', () => {
    expect(badmintonSport.resultLine(displayOf(GAME_ONE))).toBe('21–15');
    expect(badmintonSport.resultLine(displayOf([...GAME_ONE, ...GAME_TWO]))).toBe('21–15, 21–18');
  });

  it('keeps the top side first when the bottom side wins the game', () => {
    const away = [start(), ...rallies('H'.repeat(15)), ...rallies('A'.repeat(21))];
    expect(badmintonSport.resultLine(displayOf(away))).toBe('15–21');
  });

  it('names a game a disqualification ended at the points it stood, and the match is decided', () => {
    const dq = [
      ...GAME_ONE,
      ...rallies('HAHAH'),
      sanction('A', 'disqualification', 'p-chen'),
      forfeit('A'),
    ];
    const display = displayOf(dq);
    expect(badmintonSport.decided(display)).toBe(true);
    expect(badmintonSport.resultLine(display)).toBe('21–15, 3–2');
  });
});
