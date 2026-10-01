import { describe, expect, it } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import { scanOutcome } from '@/domain/mode/scanOutcome';

const streamCode: ModeCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  sid: 'fake-sid',
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

  it('says a scoring code is coming soon, whichever tile was tapped', () => {
    expect(scanOutcome('stream', { outcome: 'code', code: scoringCode })).toEqual({
      kind: 'comingSoon',
      tapped: 'stream',
      mode: 'scoring',
    });
    // From its own tile too: an unbuilt mode never opens, even on a match.
    expect(scanOutcome('scoring', { outcome: 'code', code: scoringCode })).toEqual({
      kind: 'comingSoon',
      tapped: 'scoring',
      mode: 'scoring',
    });
  });

  it('offers to switch when a built mode is scanned from another tile', () => {
    // Only reachable once a second mode is built; S0 proves the branch exists.
    expect(scanOutcome('scoring', { outcome: 'code', code: streamCode })).toEqual({
      kind: 'otherMode',
      tapped: 'scoring',
      code: streamCode,
    });
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
