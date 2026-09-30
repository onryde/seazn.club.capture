import { describe, expect, it } from 'vitest';
import { endedByTimeout } from '@/domain/credentials/SessionDescriptor';

describe('endedByTimeout (D4)', () => {
  it.each([
    ['no-inbound-timeout', true],
    ['max-duration', true],
    ['stopped', false],
    ['target-rejected', false],
    ['unknown', false],
  ] as const)('%s → %s', (reason, timedOut) => {
    expect(endedByTimeout(reason)).toBe(timedOut);
  });
});
