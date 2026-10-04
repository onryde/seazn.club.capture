import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { UNREPORTED } from '@/engine/unreported';
import { ENGINE_SILENT_MS, isEngineSilent, selectReportedAtMs } from '@/hooks/engineSilence';

const AT = 1_790_000_000_000;

/**
 * CD17, from Pairing on (amendment §2: native reports at 1 Hz in every phase
 * from Pairing). Every kind, written out: a pairing is held from Pairing until
 * Idle or Ended, and only then is a quiet engine news.
 */
const ROWS: readonly (readonly [SessionState['kind'], number, boolean])[] = [
  ['idle', 60_000, false],
  ['pairing', 3_001, true],
  ['paired', 3_001, true],
  ['arming', 3_001, true],
  ['armed', 3_001, true],
  ['connecting', 3_001, true],
  ['publishing', 3_001, true],
  ['degraded', 3_001, true],
  ['reconnecting', 3_001, true],
  ['ended', 60_000, false],
  // The edge: three seconds exactly is not yet silence.
  ['publishing', 3_000, false],
  ['paired', 3_000, false],
];

describe('CD17: an engine that has stopped reporting says so', () => {
  it('checks twelve rows over all ten kinds (PV12: zero is a failure)', () => {
    expect(ROWS).toHaveLength(12);
    expect(new Set(ROWS.map(([kind]) => kind)).size).toBe(10);
  });

  it('waits three seconds, as the amendment says', () => {
    expect(ENGINE_SILENT_MS).toBe(3_000);
  });

  it.each(ROWS)('%s, %i ms since the last report: silent %s', (kind, age, silent) => {
    expect(isEngineSilent(kind, AT, AT + age)).toBe(silent);
  });

  it('a report from the future (an NTP step) is not silence', () => {
    expect(isEngineSilent('publishing', AT + 10_000, AT)).toBe(false);
  });

  // Question 2: an engine that has never reported is idle, and idle is never silent.
  it('reads the last report, and an unreported engine is not silent', () => {
    expect(selectReportedAtMs({ ...UNREPORTED, reportedAtMs: AT })).toBe(AT);
    expect(isEngineSilent(UNREPORTED.state.kind, selectReportedAtMs(UNREPORTED), AT)).toBe(false);
  });
});
