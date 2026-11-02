import type { FoldReading } from '@/domain/scoring/engineProbe';
import type { Logger } from '@/services/logger';

/** Folds per run: enough for a median and a spread, few enough to stay well under a second on a slow phone. */
export const FOLD_PROBE_RUNS = 50;

export type FoldProbeModule = typeof import('@/domain/scoring/engineProbe');

export type FoldProbeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'read'; readonly reading: FoldReading }
  | { readonly kind: 'failed'; readonly error: string };

const loadProbe = (): Promise<FoldProbeModule> => import('@/domain/scoring/engineProbe');

/** To a hundredth of a millisecond, for the record. */
const hundredths = (ms: number): number => Math.round(ms * 100) / 100;

/**
 * R4 on the phone (plan S2-1 Task 1 Step 6): folds the probe's 76-event match `runs` times and records
 * `scoring.foldProbe` with the reading. The engine is loaded here, on the tap, so an engine that cannot load or fold
 * under Hermes (zod reaching `new Function` is the worry) reads as a failure on the chip and a warning in the record
 * instead of taking the dev twin down at launch. Never rejects. `load` and `runs` are passed in by tests only.
 */
export async function runFoldProbe(
  logger: Logger,
  load: () => Promise<FoldProbeModule> = loadProbe,
  runs: number = FOLD_PROBE_RUNS,
): Promise<FoldProbeState> {
  try {
    const probe = await load();
    const reading = probe.foldReading(probe.timeFold(probe.syntheticBadmintonMatch(), runs));
    if (reading === null) return failed(logger, 'none', 'no folds');
    logger.info('scoring.foldProbe', {
      events: reading.events,
      runs: reading.runs,
      minMs: hundredths(reading.min),
      medianMs: hundredths(reading.median),
      maxMs: hundredths(reading.max),
      firstMs: hundredths(reading.first),
    });
    return { kind: 'read', reading };
  } catch (error) {
    return error instanceof Error
      ? failed(logger, error.name, `${error.name}: ${error.message}`)
      : failed(logger, 'thrown', String(error));
  }
}

/**
 * The chip's readout: nothing before the first tap, an ellipsis while it runs, then the events and the fastest, median
 * and slowest fold in ms, or the failure in its own words. A developer's numbers in the dev twin only, never copy, so
 * not in the dictionaries (as `DevProbe`'s state word).
 */
export function foldProbeLine(state: FoldProbeState): string | null {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'running':
      return '…';
    case 'read': {
      const { events, min, median, max } = state.reading;
      return `${events} · ${min.toFixed(2)} / ${median.toFixed(2)} / ${max.toFixed(2)} ms`;
    }
    case 'failed':
      return `failed: ${state.error}`;
  }
}

/** The record gets the error's name only (a plain word the scrub passes); the chip shows its words too. */
function failed(logger: Logger, name: string, words: string): FoldProbeState {
  logger.warn('scoring.foldProbe.failed', { error: name });
  return { kind: 'failed', error: words };
}
