import { describe, expect, it } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import { BUILT_MODES, scanOutcome } from '@/domain/mode/scanOutcome';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';

const streamCode: ModeCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  code: 'fx42hmnp7k2q',
  slot: 0,
  token: 'fake-token',
  expiresAt: new Date('2026-10-03T18:40:00Z'),
};
const scoringCode: ModeCode = { mode: 'scoring', raw: 'https://x/score/t', token: 't' };
/** A made-up Match Day code, as `recognise` reads one (recognise.test.ts). */
const dayCode: ModeCode = { mode: 'matchday', raw: dayLink(), token: FIXTURE_DAY_TOKEN };

describe('scanOutcome', () => {
  it('opens the mode when the code matches the tile', () => {
    expect(scanOutcome('stream', { outcome: 'code', code: streamCode })).toEqual({
      kind: 'open',
      code: streamCode,
    });
  });

  // Plan S2-1 Task 10: Remote Scoring is a built mode, so its code opens from its own tile in every build.
  it('opens a scoring code from the Remote Scoring tile', () => {
    expect(scanOutcome('scoring', { outcome: 'code', code: scoringCode })).toEqual({
      kind: 'open',
      code: scoringCode,
    });
  });

  it('offers to switch when a scoring code is scanned from another tile, and a stream code from the scoring tile', () => {
    expect(scanOutcome('stream', { outcome: 'code', code: scoringCode })).toEqual({
      kind: 'otherMode',
      tapped: 'stream',
      code: scoringCode,
    });
    expect(scanOutcome('scoring', { outcome: 'code', code: streamCode })).toEqual({
      kind: 'otherMode',
      tapped: 'scoring',
      code: streamCode,
    });
  });

  // MD-2 Task 1: Match Day is a built mode, so its code opens from its own tile (S4 design §4).
  it('a matchday code scanned from the matchday tile opens', () => {
    expect(scanOutcome('matchday', { outcome: 'code', code: dayCode })).toEqual({
      kind: 'open',
      code: dayCode,
    });
  });

  // Decision record ruling 2: a code for another mode is named, and the app offers to open it, both ways round.
  it('a scoring code scanned from the matchday tile offers to switch', () => {
    expect(scanOutcome('matchday', { outcome: 'code', code: scoringCode })).toEqual({
      kind: 'otherMode',
      tapped: 'matchday',
      code: scoringCode,
    });
    expect(scanOutcome('matchday', { outcome: 'code', code: streamCode })).toEqual({
      kind: 'otherMode',
      tapped: 'matchday',
      code: streamCode,
    });
  });

  it.each(['stream', 'scoring'] as const)(
    'a matchday code scanned from the %s tile offers to switch',
    (tapped) => {
      expect(scanOutcome(tapped, { outcome: 'code', code: dayCode })).toEqual({
        kind: 'otherMode',
        tapped,
        code: dayCode,
      });
    },
  );

  // Every mode is built now (MD-2 Task 1), so no code `recognise` reads reaches this rule. It stays for a code whose
  // mode the build has not built, so this one is made by hand: named and told it is coming soon, never opened,
  // whichever tile was tapped.
  it('says a code of a mode not built is coming soon, whichever tile was tapped', () => {
    const later = { mode: 'later', raw: 'r', token: 't' } as unknown as ModeCode;
    for (const tapped of ['stream', 'scoring', 'matchday'] as const) {
      expect(scanOutcome(tapped, { outcome: 'code', code: later })).toEqual({
        kind: 'comingSoon',
        tapped,
        mode: 'later',
      });
    }
  });

  it('builds all three modes: Live Stream, Remote Scoring and Match Day', () => {
    expect([...BUILT_MODES]).toEqual(['stream', 'scoring', 'matchday']);
  });

  it('passes the plain outcomes through with the tapped tile', () => {
    const at = new Date('2026-10-03T18:40:00Z');
    expect(scanOutcome('stream', { outcome: 'expired', mode: 'stream', at })).toEqual({
      kind: 'expired',
      tapped: 'stream',
      mode: 'stream',
      at,
    });
    // The expired panel names the code's mode, not the tile's.
    expect(scanOutcome('matchday', { outcome: 'expired', mode: 'stream', at })).toEqual({
      kind: 'expired',
      tapped: 'matchday',
      mode: 'stream',
      at,
    });
    expect(scanOutcome('stream', { outcome: 'foreign' })).toEqual({
      kind: 'foreign',
      tapped: 'stream',
    });
    expect(scanOutcome('stream', { outcome: 'seaznPage' })).toEqual({
      kind: 'seaznPage',
      tapped: 'stream',
    });
    expect(scanOutcome('stream', { outcome: 'newerVersion', mode: 'stream' })).toEqual({
      kind: 'newerVersion',
      tapped: 'stream',
    });
  });
});
