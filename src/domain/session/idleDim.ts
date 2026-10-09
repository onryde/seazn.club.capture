import type { SessionState } from '@/domain/session/SessionState';

/** R8 (spec §4.5): no touch for this long while paired and waiting, and the window dims. */
export const IDLE_DIM_MS = 30_000;

/**
 * Whether the app's window should be dim (D2 §4.5, R4, R8): only while paired and waiting for Go live, after
 * `IDLE_DIM_MS` with no touch. Never armed, live, pairing or ended: the operator must read the tally on air
 * (AGENTS §6, "Red means ON AIR"). The one guard: the hook asks this and nothing else.
 */
export function shouldDim(kind: SessionState['kind'], idleMs: number): boolean {
  return kind === 'paired' && idleMs >= IDLE_DIM_MS;
}
