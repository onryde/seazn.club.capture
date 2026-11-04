import { describe, expect, it } from 'vitest';
import { isLinkDead, resultStands } from '@/domain/scoring/queue';
import { scanErrorOf } from '@/domain/scoring/scanFailure';

/**
 * What the bootstrap's failure at a scan comes to on Home's panel (plan S2-1 Task 10; design §4 step 1): a link that
 * does not work reads as a bad link, a network that does not answer as no connection, a throttle as busy. Written out.
 */
describe('scanErrorOf', () => {
  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)(
    'reads a %s as a link that does not work',
    (code) => {
      expect(scanErrorOf({ kind: 'linkDead', code })).toEqual({ kind: 'invalid' });
    },
  );

  it.each([
    [404, 'NOT_FOUND'],
    [402, 'PAYMENT_REQUIRED'],
    [403, 'FORBIDDEN'],
  ])('reads a refusal (%s %s) as a link that does not work', (status, code) => {
    expect(scanErrorOf({ kind: 'refused', status, code })).toEqual({ kind: 'invalid' });
  });

  it('reads no answer as no connection, and a read too big to take as the same: nothing is saved either way', () => {
    expect(scanErrorOf({ kind: 'offline' })).toEqual({ kind: 'offline' });
    expect(scanErrorOf({ kind: 'tooLarge' })).toEqual({ kind: 'offline' });
  });

  it('turns the throttle’s wait into whole seconds, rounded up, never under one', () => {
    expect(scanErrorOf({ kind: 'rateLimited', retryAfterMs: 7000 })).toEqual({
      kind: 'rate-limited',
      retryAfterS: 7,
    });
    expect(scanErrorOf({ kind: 'rateLimited', retryAfterMs: 7001 })).toEqual({
      kind: 'rate-limited',
      retryAfterS: 8,
    });
    expect(scanErrorOf({ kind: 'rateLimited', retryAfterMs: 0 })).toEqual({
      kind: 'rate-limited',
      retryAfterS: 1,
    });
  });

  it('reads an answer a bootstrap never gives (a seq or rules answer) as no connection, not as a bad link', () => {
    expect(scanErrorOf({ kind: 'seqConflict', currentSeq: 3 })).toEqual({ kind: 'offline' });
    expect(scanErrorOf({ kind: 'rulesChanged', rulesVersion: 2 })).toEqual({ kind: 'offline' });
    expect(scanErrorOf({ kind: 'outdated', required: 3 })).toEqual({ kind: 'offline' });
  });
});

describe('isLinkDead', () => {
  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)('is true for %s', (word) => {
    expect(isLinkDead(word)).toBe(true);
  });

  it.each([
    'finalized',
    'forbidden',
    'gone',
    'payment',
    'cancelled',
    'carriedForward',
    null,
  ] as const)('is false for %s: a new link would not make the queue sendable', (word) => {
    expect(isLinkDead(word)).toBe(false);
  });
});

// Task 8d follow-up. The two words that say the match has a result and the server holds it: what the phone still
// queues is not part of that result.
describe('resultStands', () => {
  it.each(['finalized', 'carriedForward'] as const)('is true for %s', (word) => {
    expect(resultStands(word)).toBe(true);
  });

  it.each([
    'LINK_INVALID',
    'LINK_REVOKED',
    'LINK_EXPIRED',
    'forbidden',
    'gone',
    'payment',
    'cancelled',
    null,
  ] as const)('is false for %s', (word) => {
    expect(resultStands(word)).toBe(false);
  });
});
