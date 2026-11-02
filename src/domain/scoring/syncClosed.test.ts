import { describe, expect, it } from 'vitest';
import { closedBy } from '@/domain/scoring/sync';

// What a failed READ says about the link, for the card of a match with nothing queued (plan S2-1 Task 9: sync marks a
// queue dead only when taps are queued; the hook still owes the scorer the bad-link card).
describe('closedBy', () => {
  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)('names a %s link', (code) => {
    expect(closedBy({ kind: 'linkDead', code })).toBe(code);
  });

  it.each([
    [401, 'UNAUTHORIZED', 'LINK_INVALID'],
    [402, 'PAYMENT_REQUIRED', 'payment'],
    [403, 'RESULT_CARRIED_FORWARD', 'finalized'],
    [403, 'FORBIDDEN', 'forbidden'],
    [404, 'NOT_FOUND', 'gone'],
  ] as const)('names a %s %s refusal %s', (status, code, word) => {
    expect(closedBy({ kind: 'refused', status, code })).toBe(word);
  });

  it.each([
    { kind: 'refused', status: 422, code: 'WRONG_PHASE' },
    { kind: 'refused', status: 400, code: 'BAD_REQUEST' },
    { kind: 'offline' },
    { kind: 'tooLarge' },
    { kind: 'rateLimited', retryAfterMs: 2000 },
    { kind: 'outdated', required: 3 },
    { kind: 'seqConflict', currentSeq: 4 },
    { kind: 'rulesChanged', rulesVersion: 2 },
  ] as const)('names nothing for $kind', (failure) => {
    expect(closedBy(failure)).toBeNull();
  });
});
