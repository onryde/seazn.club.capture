import { describe, expect, it } from 'vitest';
import { IDLE_TELEMETRY, UNREPORTED } from './unreported';
import vectors from './wire/snapshot-vectors.json';

describe('the snapshot before native has reported (PV27)', () => {
  // Native's own at-rest telemetry, `wire/snapshot-vectors.json`'s base: the C4a and C4b counters included.
  it('reads at rest exactly as native writes telemetry at rest, all 25 keys', () => {
    expect(Object.keys(vectors.telemetryBase)).toHaveLength(25);
    expect(IDLE_TELEMETRY).toEqual(vectors.telemetryBase);
  });

  it('is idle at rest, every field at rest, reported at 0', () => {
    expect(UNREPORTED).toEqual({
      state: { kind: 'idle' },
      telemetry: vectors.telemetryBase,
      pairing: null,
      broadcast: null,
      ready: { camera: false, sound: false, network: false, held: false },
      refusal: null,
      lastEnd: null,
      unpaired: null,
      codeEndedPending: false,
      camera: null,
      reportedAtMs: 0,
      survivesBackground: false,
    });
  });
});
