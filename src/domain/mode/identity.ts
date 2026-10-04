import { sameCode, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';

/** What a scan or Continue does with the engine it finds (amendment, Identity rules in JS). */
export type ScanStep = 'adopt' | 'pair' | 'resetThenPair' | 'none';

/**
 * - the same code while paired: adopt, no intent;
 * - another code or slot while paired, or an idle engine: `pair` (native unpairs first);
 * - an ended engine: `reset` then `pair`, since native ignores a `pair` in Ended and
 *   applies intents in order;
 * - a held broadcast: nothing (cannot happen: Home is hidden, AGENTS §6).
 */
export function scanStep(input: {
  engine: EngineStatus;
  held: CodeName;
  code: CodeName;
}): ScanStep {
  switch (input.engine) {
    case 'live':
      return 'none';
    case 'stopped':
    case 'failed':
      return 'resetThenPair';
    case 'paired':
      return sameCode(input.held, input.code) ? 'adopt' : 'pair';
    case 'idle':
      return 'pair';
  }
}
