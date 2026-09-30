import { describe, expect, it } from 'vitest';
import { warmingGate } from '@/domain/session/warming';

const DEADLINE = new Date('2026-10-03T13:10:00Z');

describe('warmingGate (spec §1, the web’s 10-minute no-signal timeout)', () => {
  it('is open until the deadline', () => {
    expect(warmingGate(DEADLINE, new Date(DEADLINE.getTime() - 1))).toBe('open');
  });

  it('has passed at the deadline itself, not a millisecond later', () => {
    expect(warmingGate(DEADLINE, DEADLINE)).toBe('passed');
  });

  it('stays passed after it', () => {
    expect(warmingGate(DEADLINE, new Date(DEADLINE.getTime() + 60_000))).toBe('passed');
  });

  it('is unknown with no descriptor', () => {
    expect(warmingGate(null, DEADLINE)).toBe('unknown');
  });

  it('answers the same when asked twice at the same instant (pure)', () => {
    const now = new Date(DEADLINE.getTime() - 1);
    expect([warmingGate(DEADLINE, now), warmingGate(DEADLINE, now)]).toEqual(['open', 'open']);
  });
});
