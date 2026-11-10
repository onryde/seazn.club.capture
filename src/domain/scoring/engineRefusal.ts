import {
  EngineError,
  foldMatch,
  type EventEnvelope,
  type FoldableModule,
} from '@seazn/engine/core';
import { isRecord } from '@/domain/credentials/wire';
import type { EngineMatch } from '@/domain/scoring/setBasedEngine';

/**
 * The engine's word on one new event, as the server judges an append (S2-4 plan Task 4, preflight D6): any sport's, the
 * engine module a parameter. Football's `footballRefusalOf` (S2-5) with the module lifted out; the set-based sports keep
 * `setBasedRefusalOf` (`setBasedEngine.ts`), which reads their own words.
 */

/** The engine's refusal: its code, and the `reason` its data names when it names one (the kernel's lineup verdicts). */
export type EngineRefusal = { readonly code: string; readonly reason: string | null };

const reasonOf = (data: unknown): string | null =>
  isRecord(data) && typeof data.reason === 'string' ? data.reason : null;

/**
 * The engine's word against the last of `events`, judged strictly from its seq (everything before it replayed, as the
 * ledger already holds it), or null when the engine takes it. Anything but the engine's own refusal is thrown: a module
 * that falls over is a defect, not a refusal a scorer can read.
 */
export function engineRefusalOf<Cfg, State>(
  module: FoldableModule<Cfg, State>,
  match: EngineMatch<Cfg>,
  events: readonly EventEnvelope[],
): EngineRefusal | null {
  const last = events[events.length - 1];
  if (last === undefined) return null;
  try {
    foldMatch(module, match.cfg, match.lineups, events, { strictFromSeq: last.seq });
    return null;
  } catch (error) {
    if (!EngineError.is(error)) throw error;
    return { code: error.code, reason: reasonOf(error.data) };
  }
}
