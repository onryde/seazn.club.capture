import { describe, expect, it } from 'vitest';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import type { SessionState } from '@/domain/session/SessionState';

type Kind = SessionState['kind'];

/** Every state kind, by name: a kind added to `SessionState` does not compile here until it is listed. */
const KINDS: Readonly<Record<Kind, true>> = {
  idle: true,
  pairing: true,
  paired: true,
  arming: true,
  armed: true,
  connecting: true,
  publishing: true,
  degraded: true,
  reconnecting: true,
  ended: true,
};
const ALL = Object.keys(KINDS) as Kind[];

/** R8 (spec §4.5): only while paired and waiting, after 30 s with no touch. Never armed or live: the tally must read. */
describe('shouldDim', () => {
  it('waits 30 s', () => {
    expect(IDLE_DIM_MS).toBe(30_000);
  });

  it('dims paired after 30 s idle, and not a millisecond before', () => {
    expect(shouldDim('paired', 30_000)).toBe(true);
    expect(shouldDim('paired', 29_999)).toBe(false);
    expect(shouldDim('paired', 0)).toBe(false);
  });

  it.each(ALL.filter((kind) => kind !== 'paired'))('never dims %s, however long idle', (kind) => {
    expect(shouldDim(kind, 3_600_000)).toBe(false);
  });

  it('covers every state kind (anti-vacuity)', () => {
    expect(ALL).toHaveLength(10);
  });
});
