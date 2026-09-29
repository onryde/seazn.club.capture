import { describe, expect, it } from 'vitest';
import { toScanResult } from './toScanResult';

describe('toScanResult', () => {
  it.each([
    [
      { outcome: 'scanned', raw: 'abc' },
      { outcome: 'scanned', raw: 'abc' },
    ],
    [{ outcome: 'cancelled' }, { outcome: 'cancelled' }],
    [
      { outcome: 'unavailable', reason: 'installing' },
      { outcome: 'unavailable', reason: 'installing' },
    ],
    [
      { outcome: 'unavailable', reason: 'noPlayServices' },
      { outcome: 'unavailable', reason: 'noPlayServices' },
    ],
  ])('passes %j through', (value, expected) => {
    expect(toScanResult(value)).toEqual(expected);
  });

  it.each([
    null,
    undefined,
    'scanned',
    { outcome: 'scanned' },
    { outcome: 'scanned', raw: 42 },
    { outcome: 'unavailable', reason: 'martian' },
    { outcome: 'teleported' },
  ])('turns anything unexpected from native (%j) into a failure', (value) => {
    expect(toScanResult(value)).toEqual({ outcome: 'unavailable', reason: 'failed' });
  });
});
