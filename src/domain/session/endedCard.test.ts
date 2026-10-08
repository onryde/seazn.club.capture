import { describe, expect, it } from 'vitest';
import { endedLines } from '@/domain/session/endedCard';

/**
 * Spec §5's card, as lines: "Scan the code again" only after the operator's own Stop over a code that still works
 * (D7). A fatal end keeps its code; the 401 deferral's Stop (SessionMachine.kt:111) leaves a dead one (F14 a).
 */
const CASES = [
  [
    { reason: 'operator-stopped', durationMs: 754_000, codeEnded: false },
    {
      time: { kind: 'onAir', durationMs: 754_000 },
      reason: 'stopped',
      scanAgain: true,
      codeEnded: false,
    },
  ],
  [
    { reason: 'fatal-error', durationMs: 754_000, codeEnded: false },
    {
      time: { kind: 'onAir', durationMs: 754_000 },
      reason: 'failed',
      scanAgain: false,
      codeEnded: false,
    },
  ],
  [
    { reason: 'operator-stopped', durationMs: null, codeEnded: false },
    { time: { kind: 'neverLive' }, reason: 'stopped', scanAgain: true, codeEnded: false },
  ],
  [
    { reason: 'fatal-error', durationMs: null, codeEnded: false },
    { time: { kind: 'neverLive' }, reason: 'failed', scanAgain: false, codeEnded: false },
  ],
  // F14 a: the 401 deferral's Stop (SessionMachine.kt:111), before and after the first frame. The code is dead.
  [
    { reason: 'operator-stopped', durationMs: null, codeEnded: true },
    { time: { kind: 'neverLive' }, reason: 'stopped', scanAgain: false, codeEnded: true },
  ],
  [
    { reason: 'operator-stopped', durationMs: 754_000, codeEnded: true },
    {
      time: { kind: 'onAir', durationMs: 754_000 },
      reason: 'stopped',
      scanAgain: false,
      codeEnded: true,
    },
  ],
  // Controller ruling: a fatal end over a dead code says so too, in place of "Your code is kept".
  [
    { reason: 'fatal-error', durationMs: 754_000, codeEnded: true },
    {
      time: { kind: 'onAir', durationMs: 754_000 },
      reason: 'failed',
      scanAgain: false,
      codeEnded: true,
    },
  ],
  [
    { reason: 'fatal-error', durationMs: null, codeEnded: true },
    { time: { kind: 'neverLive' }, reason: 'failed', scanAgain: false, codeEnded: true },
  ],
  // M5: a session that ended inside its first second did go live (a zero is a time, not "never").
  [
    { reason: 'operator-stopped', durationMs: 0, codeEnded: false },
    {
      time: { kind: 'onAir', durationMs: 0 },
      reason: 'stopped',
      scanAgain: true,
      codeEnded: false,
    },
  ],
] as const;

describe('endedLines', () => {
  it.each(CASES)('%o', (card, lines) => expect(endedLines(card)).toEqual(lines));

  it('covers its cases', () => expect(CASES).toHaveLength(9));
});
