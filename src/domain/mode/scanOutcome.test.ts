import { describe, expect, it } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import { BUILT_MODES, scanOutcome } from '@/domain/mode/scanOutcome';

const streamCode: ModeCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  code: 'fx42hmnp7k2q',
  slot: 0,
  token: 'fake-token',
  expiresAt: new Date('2026-10-03T18:40:00Z'),
};
const scoringCode: ModeCode = { mode: 'scoring', raw: 'https://x/score/t', token: 't' };

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

  // `recognise` reads no Dashboard code yet (S4 adds it), so this one is made by hand: a mode this build has not built
  // is named and told it is coming soon, never opened, whichever tile was tapped.
  it('says a code of a mode not built is coming soon, whichever tile was tapped', () => {
    const dashboard = { mode: 'dashboard', raw: 'r', token: 't' } as unknown as ModeCode;
    for (const tapped of ['stream', 'scoring', 'dashboard'] as const) {
      expect(scanOutcome(tapped, { outcome: 'code', code: dashboard })).toEqual({
        kind: 'comingSoon',
        tapped,
        mode: 'dashboard',
      });
    }
  });

  it('builds Live Stream and Remote Scoring, and not yet the Dashboard', () => {
    expect([...BUILT_MODES]).toEqual(['stream', 'scoring']);
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
    expect(scanOutcome('dashboard', { outcome: 'expired', mode: 'stream', at })).toEqual({
      kind: 'expired',
      tapped: 'dashboard',
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
