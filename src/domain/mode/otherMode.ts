import type { Mode } from '@/domain/mode/Mode';
import type { EngineStatus } from '@/domain/mode/reopen';

/**
 * A7: opening Remote Scoring or the Dashboard while paired asks first, and
 * unpairs on confirm. Live, other modes stay blocked as today (Home is
 * hidden); idle or ended, nothing is held, so nothing is asked.
 */
export function asksBeforeOpening(mode: Mode, engine: EngineStatus): boolean {
  return mode !== 'stream' && engine === 'paired';
}
